// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {FairDrops} from "../../src/FairDrops.sol";
import {IFairDrops} from "../../src/interfaces/IFairDrops.sol";
import {MockERC20} from "./Mocks.sol";
import {TestMerkle} from "./TestMerkle.sol";

abstract contract FairDropsTestBase is Test {
    uint16 internal constant FEE_BPS = 100;
    uint32 internal constant CLAIM_WINDOW = 30 days;
    uint48 internal constant ADMIN_DELAY = 2 days;
    bytes32 internal constant SEED = keccak256("seed");
    bytes32 internal constant TRANSCRIPT = keccak256("transcript");
    address internal constant NATIVE = address(0);

    FairDrops internal fd;
    MockERC20 internal token;

    address internal admin = makeAddr("admin");
    address internal feeRecipient = makeAddr("feeRecipient");
    address internal operator = makeAddr("operator");
    address internal pauser = makeAddr("pauser");
    address internal host = makeAddr("host");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal relayer = makeAddr("relayer");

    uint256[] internal verifierKeys;

    struct Payouts {
        address[] accounts;
        uint256[] amounts;
        bytes32[][] proofs;
        bytes32 root;
        uint256 total;
    }

    function setUp() public virtual {
        vm.warp(1_750_000_000);
        fd = _deploy(1, 1);
        token = new MockERC20();

        vm.deal(host, 1000 ether);
        token.mint(host, 1_000_000e18);
        vm.prank(host);
        token.approve(address(fd), type(uint256).max);
    }

    function _deploy(uint256 verifierCount, uint8 threshold) internal returns (FairDrops) {
        delete verifierKeys;
        address[] memory verifiers = new address[](verifierCount);
        for (uint256 i = 0; i < verifierCount; ++i) {
            verifierKeys.push(0xA11CE + i);
            verifiers[i] = vm.addr(0xA11CE + i);
        }
        address[] memory operators = new address[](1);
        operators[0] = operator;
        address[] memory pausers = new address[](1);
        pausers[0] = pauser;

        return new FairDrops(
            IFairDrops.InitParams({
                admin: admin,
                adminTransferDelay: ADMIN_DELAY,
                feeRecipient: feeRecipient,
                feeBps: FEE_BPS,
                claimWindow: CLAIM_WINDOW,
                verifierThreshold: threshold,
                verifiers: verifiers,
                operators: operators,
                pausers: pausers
            })
        );
    }

    function _params(address tokenAddress, uint256 amount)
        internal
        view
        returns (IFairDrops.CreateParams memory)
    {
        return IFairDrops.CreateParams({
            token: tokenAddress,
            amount: amount,
            startTime: uint64(block.timestamp + 1 hours),
            finalizeDeadline: uint64(block.timestamp + 1 hours + 1 days),
            maxWinners: 10,
            metadata: bytes('{"title":"Test giveaway"}')
        });
    }

    function _createNative(uint256 amount) internal returns (bytes32 id) {
        vm.prank(host);
        id = fd.createGiveaway{value: amount}(_params(NATIVE, amount));
    }

    function _createToken(uint256 amount) internal returns (bytes32 id) {
        vm.prank(host);
        id = fd.createGiveaway(_params(address(token), amount));
    }

    function _commit(bytes32 id) internal {
        vm.prank(operator);
        fd.commitSeed(id, keccak256(abi.encode(id, SEED)));
    }

    function _start(bytes32 id) internal {
        vm.warp(fd.getGiveaway(id).startTime);
    }

    function _settlement(bytes32 root, uint256 total, uint32 winnerCount)
        internal
        pure
        returns (IFairDrops.Settlement memory)
    {
        return IFairDrops.Settlement({
            payoutRoot: root,
            totalPayout: total,
            winnerCount: winnerCount,
            seed: SEED,
            transcriptHash: TRANSCRIPT
        });
    }

    /// @dev Signs with `keys`, ordered by ascending signer address as the contract requires.
    function _sign(bytes32 id, IFairDrops.Settlement memory s, uint256[] memory keys)
        internal
        view
        returns (bytes[] memory signatures)
    {
        uint256[] memory sorted = _sortByAddress(keys);
        bytes32 digest = fd.settlementDigest(id, s);
        signatures = new bytes[](sorted.length);
        for (uint256 i = 0; i < sorted.length; ++i) {
            (uint8 v, bytes32 r, bytes32 sig) = vm.sign(sorted[i], digest);
            signatures[i] = abi.encodePacked(r, sig, v);
        }
    }

    function _signThreshold(bytes32 id, IFairDrops.Settlement memory s)
        internal
        view
        returns (bytes[] memory)
    {
        uint256 threshold = fd.verifierThreshold();
        uint256[] memory keys = new uint256[](threshold);
        for (uint256 i = 0; i < threshold; ++i) {
            keys[i] = verifierKeys[i];
        }
        return _sign(id, s, keys);
    }

    function _payouts(bytes32 id, address[] memory accounts, uint256[] memory amounts)
        internal
        view
        returns (Payouts memory p)
    {
        bytes32[] memory leaves = new bytes32[](accounts.length);
        for (uint256 i = 0; i < accounts.length; ++i) {
            leaves[i] = fd.payoutLeaf(id, accounts[i], amounts[i]);
            p.total += amounts[i];
        }
        p.accounts = accounts;
        p.amounts = amounts;
        p.root = TestMerkle.root(leaves);
        p.proofs = new bytes32[][](accounts.length);
        for (uint256 i = 0; i < accounts.length; ++i) {
            p.proofs[i] = TestMerkle.proof(leaves, i);
        }
    }

    /// @dev Commits the seed, advances to the start and finalizes with the given payouts.
    function _finalize(bytes32 id, address[] memory accounts, uint256[] memory amounts)
        internal
        returns (Payouts memory p)
    {
        p = _payouts(id, accounts, amounts);
        _commit(id);
        _start(id);
        IFairDrops.Settlement memory s = _settlement(p.root, p.total, uint32(accounts.length));
        vm.prank(relayer);
        fd.finalize(id, s, _signThreshold(id, s));
    }

    function _two(address a, address b) internal pure returns (address[] memory list) {
        list = new address[](2);
        list[0] = a;
        list[1] = b;
    }

    function _two(uint256 a, uint256 b) internal pure returns (uint256[] memory list) {
        list = new uint256[](2);
        list[0] = a;
        list[1] = b;
    }

    function _sortByAddress(uint256[] memory keys) internal pure returns (uint256[] memory) {
        uint256[] memory sorted = new uint256[](keys.length);
        for (uint256 i = 0; i < keys.length; ++i) {
            sorted[i] = keys[i];
        }
        for (uint256 i = 1; i < sorted.length; ++i) {
            uint256 key = sorted[i];
            uint256 j = i;
            while (j > 0 && vm.addr(sorted[j - 1]) > vm.addr(key)) {
                sorted[j] = sorted[j - 1];
                --j;
            }
            sorted[j] = key;
        }
        return sorted;
    }
}
