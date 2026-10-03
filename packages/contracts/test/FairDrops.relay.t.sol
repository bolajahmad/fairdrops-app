// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";
import {IFairDrops} from "../src/interfaces/IFairDrops.sol";
import {FairDropsTestBase} from "./utils/FairDropsTestBase.sol";
import {PermitToken} from "./utils/Mocks.sol";

/// @notice Gas-free actions: someone signs, a relayer submits and keeps the fee they agreed to.
contract FairDropsRelayTest is FairDropsTestBase {
    bytes32 private constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant PERMIT_TYPEHASH = keccak256(
        "Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"
    );

    address private winner;
    uint256 private winnerKey;
    address private signer;
    uint256 private signerKey;
    address private dest = makeAddr("dest");
    address private stranger = makeAddr("stranger");

    function setUp() public override {
        super.setUp();
        (winner, winnerKey) = makeAddrAndKey("winner");
        (signer, signerKey) = makeAddrAndKey("signer");
        token.mint(signer, 1000e18);
    }

    // Collecting a prize to another wallet

    function test_ClaimWithSig_PaysRecipientAndRelayer() public {
        (bytes32 id, Payouts memory p) = _won(10e18);
        IFairDrops.ClaimRequest memory r = _request(id, p);
        IFairDrops.Authorization memory auth =
            _claimAuth(r, dest, 0.1e18, winnerKey, 0, block.timestamp + 1 hours);

        vm.expectEmit(true, true, true, true);
        emit IFairDrops.RelayFeePaid(id, winner, relayer, 0.1e18);
        vm.prank(relayer);
        fd.claimWithSig(r, dest, 0.1e18, auth);

        assertEq(token.balanceOf(dest), 9.9e18);
        assertEq(token.balanceOf(relayer), 0.1e18);
        assertTrue(fd.isClaimed(id, winner));
        assertEq(fd.nonces(winner), 1);
    }

    function test_ClaimWithSig_RejectsAnotherFee() public {
        (bytes32 id, Payouts memory p) = _won(10e18);
        IFairDrops.ClaimRequest memory r = _request(id, p);
        IFairDrops.Authorization memory auth =
            _claimAuth(r, dest, 0.1e18, winnerKey, 0, block.timestamp + 1 hours);

        vm.prank(relayer);
        vm.expectRevert(IFairDrops.InvalidSignature.selector);
        fd.claimWithSig(r, dest, 0.5e18, auth);
    }

    function test_ClaimWithSig_RejectsAnotherSigner() public {
        (bytes32 id, Payouts memory p) = _won(10e18);
        IFairDrops.ClaimRequest memory r = _request(id, p);
        IFairDrops.Authorization memory auth =
            _claimAuth(r, dest, 0, signerKey, 0, block.timestamp + 1 hours);

        vm.expectRevert(IFairDrops.InvalidSignature.selector);
        fd.claimWithSig(r, dest, 0, auth);
    }

    function test_ClaimWithSig_RejectsAnExpiredOrReusedSignature() public {
        (bytes32 id, Payouts memory p) = _won(10e18);
        IFairDrops.ClaimRequest memory r = _request(id, p);
        IFairDrops.Authorization memory late =
            _claimAuth(r, dest, 0, winnerKey, 0, block.timestamp - 1);
        vm.expectRevert(IFairDrops.SignatureExpired.selector);
        fd.claimWithSig(r, dest, 0, late);

        IFairDrops.Authorization memory skipped =
            _claimAuth(r, dest, 0, winnerKey, 1, block.timestamp + 1 hours);
        vm.expectRevert(abi.encodeWithSelector(Nonces.InvalidAccountNonce.selector, winner, 0));
        fd.claimWithSig(r, dest, 0, skipped);
    }

    function test_ClaimWithSig_FeeMustLeaveTheWinnerSomething() public {
        (bytes32 id, Payouts memory p) = _won(10e18);
        IFairDrops.ClaimRequest memory r = _request(id, p);
        IFairDrops.Authorization memory auth =
            _claimAuth(r, dest, 10e18, winnerKey, 0, block.timestamp + 1 hours);
        vm.expectRevert(IFairDrops.FeeTooHigh.selector);
        fd.claimWithSig(r, dest, 10e18, auth);
    }

    // Collecting for winners unprompted

    function test_ClaimManyFor_KeepsACappedFee() public {
        (bytes32 id, Payouts memory p) = _won(10e18);
        IFairDrops.ClaimRequest[] memory requests = new IFairDrops.ClaimRequest[](1);
        requests[0] = _request(id, p);
        uint256[] memory fees = new uint256[](1);
        fees[0] = 0.2e18; // exactly 2%

        vm.prank(relayer);
        fd.claimManyFor(requests, fees);
        assertEq(token.balanceOf(winner), 9.8e18);
        assertEq(token.balanceOf(relayer), 0.2e18);
    }

    function test_ClaimManyFor_RefusesAFeeAboveTheCap() public {
        (bytes32 id, Payouts memory p) = _won(10e18);
        IFairDrops.ClaimRequest[] memory requests = new IFairDrops.ClaimRequest[](1);
        requests[0] = _request(id, p);
        uint256[] memory fees = new uint256[](1);
        fees[0] = 0.2e18 + 1;

        vm.prank(relayer);
        vm.expectRevert(IFairDrops.FeeTooHigh.selector);
        fd.claimManyFor(requests, fees);
    }

    function test_ClaimManyFor_OnlyRelayers() public {
        (bytes32 id, Payouts memory p) = _won(10e18);
        IFairDrops.ClaimRequest[] memory requests = new IFairDrops.ClaimRequest[](1);
        requests[0] = _request(id, p);
        uint256[] memory fees = new uint256[](1);

        bytes32 role = fd.RELAYER_ROLE();
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, role
            )
        );
        fd.claimManyFor(requests, fees);
    }

    // Payout wallet

    function test_SetPayoutWalletWithSig_RedirectsLaterClaims() public {
        (bytes32 id, Payouts memory p) = _won(10e18);
        bytes32 structHash = keccak256(
            abi.encode(fd.PAYOUT_WALLET_TYPEHASH(), winner, dest, 0, block.timestamp + 1 hours)
        );
        vm.prank(relayer);
        fd.setPayoutWalletWithSig(
            winner, dest, _auth(winnerKey, structHash, 0, block.timestamp + 1 hours)
        );
        assertEq(fd.payoutWallet(winner), dest);

        fd.claim(id, winner, p.amounts[0], p.proofs[0]);
        assertEq(token.balanceOf(dest), 10e18);
    }

    // Host withdrawals

    function test_WithdrawWithSig_SendsTheRefundLessTheFee() public {
        vm.startPrank(signer);
        token.approve(address(fd), 100e18);
        bytes32 id = fd.createGiveaway(_params(address(token), 100e18));
        vm.stopPrank();
        vm.warp(fd.getGiveaway(id).finalizeDeadline + 1);

        bytes32 structHash = keccak256(
            abi.encode(
                fd.WITHDRAW_TO_TYPEHASH(), id, signer, dest, 1e18, 0, block.timestamp + 1 hours
            )
        );
        vm.prank(relayer);
        fd.withdrawWithSig(
            id, dest, 1e18, _auth(signerKey, structHash, 0, block.timestamp + 1 hours)
        );

        assertEq(token.balanceOf(dest), 99e18);
        assertEq(token.balanceOf(relayer), 1e18);
        assertEq(uint8(fd.getGiveaway(id).status), uint8(IFairDrops.Status.Expired));
    }

    // Opening a giveaway for a host

    function test_CreateGiveawayFor_WithAPermitAndNoGas() public {
        PermitToken usd = new PermitToken();
        usd.mint(signer, 100e18);
        IFairDrops.CreateParams memory p = _params(address(usd), 100e18);

        IFairDrops.Permit memory permit = _permit(usd, signerKey, 100e18);
        IFairDrops.Authorization memory auth = _createAuth(p, 1e18);
        vm.prank(relayer);
        bytes32 id = fd.createGiveawayFor(p, signer, 1e18, auth, permit);

        IFairDrops.Giveaway memory g = fd.getGiveaway(id);
        assertEq(g.host, signer);
        // 99 deposited after the relay fee; 1% of that is FairDrops' fee.
        assertEq(g.prize + g.fee, 99e18);
        assertEq(g.fee, 0.99e18);
        assertEq(usd.balanceOf(relayer), 1e18);
        assertEq(usd.balanceOf(signer), 0);
    }

    function test_CreateGiveawayFor_UsesAnExistingAllowanceWithoutAPermit() public {
        vm.prank(signer);
        token.approve(address(fd), 50e18);
        IFairDrops.CreateParams memory p = _params(address(token), 50e18);
        IFairDrops.Permit memory none;

        vm.prank(relayer);
        bytes32 id = fd.createGiveawayFor(p, signer, 0, _createAuth(p, 0), none);
        assertEq(fd.getGiveaway(id).host, signer);
    }

    function test_CreateGiveawayFor_RefusesNativePrizes() public {
        IFairDrops.CreateParams memory p = _params(NATIVE, 1 ether);
        IFairDrops.Permit memory none;
        IFairDrops.Authorization memory auth = _createAuth(p, 0);
        vm.expectRevert(IFairDrops.InvalidToken.selector);
        fd.createGiveawayFor(p, signer, 0, auth, none);
    }

    function test_CreateGiveawayFor_RejectsChangedTerms() public {
        vm.prank(signer);
        token.approve(address(fd), 50e18);
        IFairDrops.CreateParams memory p = _params(address(token), 50e18);
        IFairDrops.Authorization memory auth = _createAuth(p, 0);
        p.maxWinners = 1;
        IFairDrops.Permit memory none;
        vm.expectRevert(IFairDrops.InvalidSignature.selector);
        fd.createGiveawayFor(p, signer, 0, auth, none);
    }

    // Helpers

    /// @dev A finalized token giveaway in which `winner` won `amount`.
    function _won(uint256 amount) private returns (bytes32 id, Payouts memory p) {
        id = _createToken(100e18);
        address[] memory accounts = new address[](1);
        accounts[0] = winner;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = amount;
        p = _finalize(id, accounts, amounts);
    }

    function _request(bytes32 id, Payouts memory p)
        private
        pure
        returns (IFairDrops.ClaimRequest memory)
    {
        return IFairDrops.ClaimRequest({
            id: id,
            account: p.accounts[0],
            amount: p.amounts[0],
            proof: p.proofs[0]
        });
    }

    function _claimAuth(
        IFairDrops.ClaimRequest memory r,
        address recipient,
        uint256 fee,
        uint256 key,
        uint256 nonce,
        uint256 deadline
    ) private view returns (IFairDrops.Authorization memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                fd.CLAIM_TO_TYPEHASH(), r.id, r.account, r.amount, recipient, fee, nonce, deadline
            )
        );
        return _auth(key, structHash, nonce, deadline);
    }

    function _createAuth(IFairDrops.CreateParams memory p, uint256 relayFee)
        private
        view
        returns (IFairDrops.Authorization memory)
    {
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 structHash = keccak256(
            abi.encode(
                fd.CREATE_GIVEAWAY_TYPEHASH(),
                signer,
                p.token,
                p.amount,
                p.startTime,
                p.finalizeDeadline,
                p.maxWinners,
                keccak256(p.metadata),
                relayFee,
                fd.nonces(signer),
                deadline
            )
        );
        return _auth(signerKey, structHash, fd.nonces(signer), deadline);
    }

    function _auth(uint256 key, bytes32 structHash, uint256 nonce, uint256 deadline)
        private
        view
        returns (IFairDrops.Authorization memory)
    {
        bytes32 domain = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH, keccak256("FairDrops"), keccak256("1"), block.chainid, address(fd)
            )
        );
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(key, keccak256(abi.encodePacked("\x19\x01", domain, structHash)));
        return IFairDrops.Authorization({
            nonce: nonce,
            deadline: deadline,
            signature: abi.encodePacked(r, s, v)
        });
    }

    function _permit(PermitToken usd, uint256 key, uint256 value)
        private
        view
        returns (IFairDrops.Permit memory)
    {
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 structHash =
            keccak256(abi.encode(PERMIT_TYPEHASH, vm.addr(key), address(fd), value, 0, deadline));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(
            key, keccak256(abi.encodePacked("\x19\x01", usd.DOMAIN_SEPARATOR(), structHash))
        );
        return IFairDrops.Permit({value: value, deadline: deadline, v: v, r: r, s: s});
    }
}
