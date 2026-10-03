// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {FairDropsAccount} from "../src/FairDropsAccount.sol";
import {IFairDrops} from "../src/interfaces/IFairDrops.sol";
import {FairDropsTestBase} from "./utils/FairDropsTestBase.sol";

/// @notice An embedded wallet delegated to FairDropsAccount (EIP-7702): the owner signs a batch,
/// a relayer submits it and is paid from the batch, and the owner never holds gas.
contract FairDropsAccountTest is FairDropsTestBase {
    bytes32 private constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );

    FairDropsAccount private implementation;
    address private owner;
    uint256 private ownerKey;
    address private dest = makeAddr("dest");

    function setUp() public override {
        super.setUp();
        implementation = new FairDropsAccount();
        (owner, ownerKey) = makeAddrAndKey("owner");
        token.mint(owner, 100e18);
        vm.signAndAttachDelegation(address(implementation), ownerKey);
    }

    function test_SendsTokensAndPaysTheRelayer() public {
        FairDropsAccount.Call[] memory calls = new FairDropsAccount.Call[](2);
        calls[0] = _transfer(dest, 40e18);
        calls[1] = _transfer(relayer, 0.5e18);
        bytes memory signature = _sign(calls, 0, block.timestamp + 1 hours);

        vm.prank(relayer);
        FairDropsAccount(payable(owner)).execute(calls, block.timestamp + 1 hours, signature);

        assertEq(token.balanceOf(dest), 40e18);
        assertEq(token.balanceOf(relayer), 0.5e18);
        assertEq(token.balanceOf(owner), 59.5e18);
        assertEq(FairDropsAccount(payable(owner)).nonce(), 1);
    }

    function test_SendsTheNativeCoin() public {
        vm.deal(owner, 1 ether);
        FairDropsAccount.Call[] memory calls = new FairDropsAccount.Call[](2);
        calls[0] = FairDropsAccount.Call({to: dest, value: 0.6 ether, data: ""});
        calls[1] = FairDropsAccount.Call({to: relayer, value: 0.01 ether, data: ""});
        bytes memory signature = _sign(calls, 0, block.timestamp + 1 hours);

        FairDropsAccount(payable(owner)).execute(calls, block.timestamp + 1 hours, signature);
        assertEq(dest.balance, 0.6 ether);
        assertEq(relayer.balance, 0.01 ether);
    }

    function test_HostsAGiveawayWithoutGas() public {
        IFairDrops.CreateParams memory p = _params(address(token), 50e18);
        FairDropsAccount.Call[] memory calls = new FairDropsAccount.Call[](3);
        calls[0] = FairDropsAccount.Call({
            to: address(token),
            value: 0,
            data: abi.encodeCall(token.approve, (address(fd), 50e18))
        });
        calls[1] = FairDropsAccount.Call({
            to: address(fd),
            value: 0,
            data: abi.encodeCall(fd.createGiveaway, (p))
        });
        calls[2] = _transfer(relayer, 0.5e18);

        vm.recordLogs();
        FairDropsAccount(payable(owner)).execute(
            calls, block.timestamp + 1 hours, _sign(calls, 0, block.timestamp + 1 hours)
        );

        bytes32 id = keccak256(abi.encode(block.chainid, address(fd), fd.giveawayCount()));
        assertEq(fd.getGiveaway(id).host, owner);
        assertEq(token.balanceOf(relayer), 0.5e18);
    }

    function test_StillSignsFairDropsActionsOnceDelegated() public {
        bytes32 id = _createToken(100e18);
        address[] memory accounts = new address[](1);
        accounts[0] = owner;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 10e18;
        Payouts memory p = _finalize(id, accounts, amounts);

        IFairDrops.ClaimRequest memory r =
            IFairDrops.ClaimRequest({id: id, account: owner, amount: 10e18, proof: p.proofs[0]});
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 structHash = keccak256(
            abi.encode(fd.CLAIM_TO_TYPEHASH(), id, owner, 10e18, dest, 0.1e18, 0, deadline)
        );
        bytes32 domain = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH, keccak256("FairDrops"), keccak256("1"), block.chainid, address(fd)
            )
        );
        (uint8 v, bytes32 rs, bytes32 ss) =
            vm.sign(ownerKey, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));

        vm.prank(relayer);
        fd.claimWithSig(
            r,
            dest,
            0.1e18,
            IFairDrops.Authorization({
                nonce: 0,
                deadline: deadline,
                signature: abi.encodePacked(rs, ss, v)
            })
        );
        assertEq(token.balanceOf(dest), 9.9e18);
    }

    function test_RefusesAnotherSigner() public {
        FairDropsAccount.Call[] memory calls = new FairDropsAccount.Call[](1);
        calls[0] = _transfer(dest, 1e18);
        (, uint256 otherKey) = makeAddrAndKey("other");
        bytes memory signature = _signWith(otherKey, calls, 0, block.timestamp + 1 hours);

        vm.expectRevert(FairDropsAccount.NotOwner.selector);
        FairDropsAccount(payable(owner)).execute(calls, block.timestamp + 1 hours, signature);
    }

    function test_RefusesAReplayAnExpiredBatchOrChangedCalls() public {
        FairDropsAccount.Call[] memory calls = new FairDropsAccount.Call[](1);
        calls[0] = _transfer(dest, 1e18);
        bytes memory signature = _sign(calls, 0, block.timestamp + 1 hours);
        FairDropsAccount account = FairDropsAccount(payable(owner));
        account.execute(calls, block.timestamp + 1 hours, signature);

        // Same batch again: the nonce has moved on.
        vm.expectRevert(FairDropsAccount.NotOwner.selector);
        account.execute(calls, block.timestamp + 1 hours, signature);

        bytes memory late = _sign(calls, 1, block.timestamp - 1);
        vm.expectRevert(FairDropsAccount.Expired.selector);
        account.execute(calls, block.timestamp - 1, late);

        bytes memory fresh = _sign(calls, 1, block.timestamp + 1 hours);
        calls[0] = _transfer(dest, 2e18);
        vm.expectRevert(FairDropsAccount.NotOwner.selector);
        account.execute(calls, block.timestamp + 1 hours, fresh);
    }

    function test_AFailingCallUndoesTheWholeBatch() public {
        FairDropsAccount.Call[] memory calls = new FairDropsAccount.Call[](2);
        calls[0] = _transfer(relayer, 1e18);
        calls[1] = _transfer(dest, 1000e18); // more than the owner holds
        bytes memory signature = _sign(calls, 0, block.timestamp + 1 hours);

        vm.expectRevert();
        FairDropsAccount(payable(owner)).execute(calls, block.timestamp + 1 hours, signature);
        assertEq(token.balanceOf(relayer), 0);
        assertEq(FairDropsAccount(payable(owner)).nonce(), 0);
    }

    function test_DigestMatchesTheContract() public view {
        FairDropsAccount.Call[] memory calls = new FairDropsAccount.Call[](1);
        calls[0] = _transfer(dest, 1e18);
        assertEq(
            FairDropsAccount(payable(owner)).executeDigest(calls, 0, 123), _digest(calls, 0, 123)
        );
    }

    function _transfer(address to, uint256 amount)
        private
        view
        returns (FairDropsAccount.Call memory)
    {
        return FairDropsAccount.Call({
            to: address(token),
            value: 0,
            data: abi.encodeCall(token.transfer, (to, amount))
        });
    }

    function _sign(FairDropsAccount.Call[] memory calls, uint256 nonce, uint256 deadline)
        private
        view
        returns (bytes memory)
    {
        return _signWith(ownerKey, calls, nonce, deadline);
    }

    function _signWith(
        uint256 key,
        FairDropsAccount.Call[] memory calls,
        uint256 nonce,
        uint256 deadline
    ) private view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, _digest(calls, nonce, deadline));
        return abi.encodePacked(r, s, v);
    }

    /// @dev Built independently of the contract, as a client would.
    function _digest(FairDropsAccount.Call[] memory calls, uint256 nonce, uint256 deadline)
        private
        view
        returns (bytes32)
    {
        bytes32[] memory hashes = new bytes32[](calls.length);
        for (uint256 i = 0; i < calls.length; ++i) {
            hashes[i] = keccak256(
                abi.encode(
                    keccak256("Call(address to,uint256 value,bytes data)"),
                    calls[i].to,
                    calls[i].value,
                    keccak256(calls[i].data)
                )
            );
        }
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "Execute(Call[] calls,uint256 nonce,uint256 deadline)Call(address to,uint256 value,bytes data)"
                ),
                keccak256(abi.encodePacked(hashes)),
                nonce,
                deadline
            )
        );
        bytes32 domain = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH, keccak256("FairDropsAccount"), keccak256("1"), block.chainid, owner
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domain, structHash));
    }
}
