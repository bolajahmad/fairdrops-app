// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {FairDrops} from "../../src/FairDrops.sol";
import {IFairDrops} from "../../src/interfaces/IFairDrops.sol";
import {MockERC20} from "../utils/Mocks.sol";
import {TestMerkle} from "../utils/TestMerkle.sol";

/// @dev Drives random but valid sequences of FairDrops calls. Guards skip calls that would
/// revert so the fuzzer spends its depth on reachable states.
contract FairDropsHandler is Test {
    bytes32 internal constant SEED = keccak256("invariant seed");

    FairDrops public immutable fd;
    MockERC20 public immutable token;
    address public immutable operator;
    uint256 internal immutable verifierKey;

    address[] public actors;
    bytes32[] public ids;

    mapping(bytes32 id => address[2]) internal winners;
    mapping(bytes32 id => uint256[2]) internal shares;
    mapping(bytes32 id => bytes32[][2]) internal proofs;

    mapping(address token => uint256) public feesWithdrawn;
    mapping(bytes4 selector => uint256) public calls;

    constructor(FairDrops fd_, MockERC20 token_, address operator_, uint256 verifierKey_) {
        fd = fd_;
        token = token_;
        operator = operator_;
        verifierKey = verifierKey_;
        for (uint256 i = 0; i < 4; ++i) {
            address actor = makeAddr(string.concat("actor", vm.toString(i)));
            actors.push(actor);
            vm.deal(actor, 1e30);
            token_.mint(actor, 1e30);
            vm.prank(actor);
            token_.approve(address(fd_), type(uint256).max);
        }
    }

    function idCount() external view returns (uint256) {
        return ids.length;
    }

    function create(uint256 actorSeed, uint256 amount, bool native) external {
        address host = actors[actorSeed % actors.length];
        amount = bound(amount, 1, 1e24);
        address asset = native ? address(0) : address(token);
        IFairDrops.CreateParams memory p = IFairDrops.CreateParams({
            token: asset,
            amount: amount,
            startTime: uint64(block.timestamp + 1 hours),
            finalizeDeadline: uint64(block.timestamp + 1 days),
            maxWinners: 2,
            metadata: ""
        });

        vm.prank(host);
        bytes32 id = fd.createGiveaway{value: native ? amount : 0}(p);
        ids.push(id);
        calls[this.create.selector]++;
    }

    function addFunds(uint256 idSeed, uint256 amount) external {
        (bool found, bytes32 id, IFairDrops.Giveaway memory g) = _pick(idSeed);
        if (!found || g.status != IFairDrops.Status.Active || block.timestamp >= g.startTime) {
            return;
        }
        amount = bound(amount, 1, 1e24);

        vm.prank(g.host);
        fd.addFunds{value: g.token == address(0) ? amount : 0}(id, amount);
        calls[this.addFunds.selector]++;
    }

    function commitSeed(uint256 idSeed) external {
        (bool found, bytes32 id, IFairDrops.Giveaway memory g) = _pick(idSeed);
        if (
            !found || g.status != IFairDrops.Status.Active || block.timestamp >= g.startTime
                || g.seedCommitment != bytes32(0)
        ) return;

        vm.prank(operator);
        fd.commitSeed(id, keccak256(abi.encode(id, SEED)));
        calls[this.commitSeed.selector]++;
    }

    function warp(uint256 seconds_) external {
        vm.warp(block.timestamp + bound(seconds_, 1 minutes, 6 hours));
        calls[this.warp.selector]++;
    }

    /// @dev Moves an active giveaway into its game window (committing the seed and warping to
    /// the start when needed) so settlements are exercised on most runs.
    function finalize(uint256 idSeed, uint256 winnerSeed, uint256 firstShare, uint256 secondShare)
        external
    {
        (bool found, bytes32 id, IFairDrops.Giveaway memory g) = _findFinalizable(idSeed);
        if (!found) return;
        if (g.seedCommitment == bytes32(0)) {
            vm.prank(operator);
            fd.commitSeed(id, keccak256(abi.encode(id, SEED)));
        }
        if (block.timestamp < g.startTime) vm.warp(g.startTime);

        address a = actors[winnerSeed % actors.length];
        address b = actors[(winnerSeed % actors.length + 1) % actors.length];
        uint256 x = bound(firstShare, 1, g.prize - 1);
        uint256 y = bound(secondShare, 1, g.prize - x);

        bytes32[] memory leaves = new bytes32[](2);
        leaves[0] = fd.payoutLeaf(id, a, x);
        leaves[1] = fd.payoutLeaf(id, b, y);
        winners[id] = [a, b];
        shares[id] = [x, y];
        proofs[id][0] = TestMerkle.proof(leaves, 0);
        proofs[id][1] = TestMerkle.proof(leaves, 1);

        IFairDrops.Settlement memory s = IFairDrops.Settlement({
            payoutRoot: TestMerkle.root(leaves),
            totalPayout: x + y,
            winnerCount: 2,
            seed: SEED,
            transcriptHash: keccak256(abi.encode(id))
        });
        (uint8 v, bytes32 r, bytes32 sig) = vm.sign(verifierKey, fd.settlementDigest(id, s));
        bytes[] memory signatures = new bytes[](1);
        signatures[0] = abi.encodePacked(r, sig, v);

        fd.finalize(id, s, signatures);
        calls[this.finalize.selector]++;
    }

    function claim(uint256 idSeed, uint256 which) external {
        (bool found, bytes32 id, IFairDrops.Giveaway memory g) =
            _find(idSeed, IFairDrops.Status.Finalized);
        if (!found || block.timestamp > g.claimDeadline) return;
        uint256 i = which % 2;
        address account = winners[id][i];
        if (fd.isClaimed(id, account)) return;

        fd.claim(id, account, shares[id][i], proofs[id][i]);
        calls[this.claim.selector]++;
    }

    function cancel(uint256 idSeed, bool asOperator) external {
        (bool found, bytes32 id, IFairDrops.Giveaway memory g) = _pick(idSeed);
        if (!found || g.status != IFairDrops.Status.Active) return;
        if (!asOperator && block.timestamp >= g.startTime) return;

        vm.prank(asOperator ? operator : g.host);
        fd.cancel(id);
        calls[this.cancel.selector]++;
    }

    function withdraw(uint256 idSeed) external {
        for (uint256 i = 0; i < ids.length; ++i) {
            bytes32 id = ids[(idSeed % ids.length + i) % ids.length];
            if (fd.hostWithdrawable(id) == 0) continue;
            vm.prank(fd.getGiveaway(id).host);
            fd.withdraw(id);
            calls[this.withdraw.selector]++;
            return;
        }
    }

    function withdrawFees(bool native) external {
        address asset = native ? address(0) : address(token);
        uint256 amount = fd.accruedFees(asset);
        if (amount == 0) return;

        fd.withdrawFees(asset);
        feesWithdrawn[asset] += amount;
        calls[this.withdrawFees.selector]++;
    }

    /// @dev First giveaway at or after `seed` (wrapping) with the given status.
    function _find(uint256 seed, IFairDrops.Status status)
        private
        view
        returns (bool found, bytes32 id, IFairDrops.Giveaway memory g)
    {
        for (uint256 i = 0; i < ids.length; ++i) {
            id = ids[(seed % ids.length + i) % ids.length];
            g = fd.getGiveaway(id);
            if (g.status == status) return (true, id, g);
        }
    }

    function _findFinalizable(uint256 seed)
        private
        view
        returns (bool found, bytes32 id, IFairDrops.Giveaway memory g)
    {
        for (uint256 i = 0; i < ids.length; ++i) {
            id = ids[(seed % ids.length + i) % ids.length];
            g = fd.getGiveaway(id);
            bool open =
                g.status == IFairDrops.Status.Active && block.timestamp <= g.finalizeDeadline;
            bool reachable = g.seedCommitment != bytes32(0) || block.timestamp < g.startTime;
            if (open && reachable && g.prize >= 2) return (true, id, g);
        }
    }

    function _pick(uint256 seed)
        private
        view
        returns (bool found, bytes32 id, IFairDrops.Giveaway memory g)
    {
        if (ids.length == 0) return (false, bytes32(0), g);
        id = ids[seed % ids.length];
        return (true, id, fd.getGiveaway(id));
    }
}
