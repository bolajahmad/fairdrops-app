// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {FairDrops} from "../src/FairDrops.sol";
import {IFairDrops} from "../src/interfaces/IFairDrops.sol";
import {FairDropsTestBase} from "./utils/FairDropsTestBase.sol";
import {RejectingReceiver, ReentrantToken} from "./utils/Mocks.sol";

contract FairDropsSettlementTest is FairDropsTestBase {
    // Finalize

    function test_finalize_recordsSettlementAndAccruesFee() public {
        bytes32 id = _createNative(10 ether);
        Payouts memory p = _payouts(id, _two(alice, bob), _two(6 ether, 3 ether));
        _commit(id);
        _start(id);
        IFairDrops.Settlement memory s = _settlement(p.root, p.total, 2);

        vm.expectEmit(address(fd));
        emit IFairDrops.GiveawayFinalized(
            id, p.root, 9 ether, 2, SEED, TRANSCRIPT, uint64(block.timestamp) + CLAIM_WINDOW
        );
        vm.prank(relayer);
        fd.finalize(id, s, _signThreshold(id, s));

        IFairDrops.Giveaway memory g = fd.getGiveaway(id);
        assertEq(uint8(g.status), uint8(IFairDrops.Status.Finalized));
        assertEq(g.payoutRoot, p.root);
        assertEq(g.totalPayout, 9 ether);
        assertEq(g.winnerCount, 2);
        assertEq(g.transcriptHash, TRANSCRIPT);
        assertEq(fd.accruedFees(NATIVE), 0.1 ether);
    }

    function test_revert_finalize_beforeStart() public {
        bytes32 id = _createNative(1 ether);
        _commit(id);
        IFairDrops.Settlement memory s = _settlement(keccak256("root"), 0.5 ether, 1);
        bytes[] memory sigs = _signThreshold(id, s);
        vm.expectRevert(IFairDrops.TooEarly.selector);
        fd.finalize(id, s, sigs);
    }

    function test_revert_finalize_afterDeadline() public {
        bytes32 id = _createNative(1 ether);
        _commit(id);
        vm.warp(fd.getGiveaway(id).finalizeDeadline + 1);
        IFairDrops.Settlement memory s = _settlement(keccak256("root"), 0.5 ether, 1);
        bytes[] memory sigs = _signThreshold(id, s);
        vm.expectRevert(IFairDrops.TooLate.selector);
        fd.finalize(id, s, sigs);
    }

    function test_revert_finalize_withoutSeedCommitment() public {
        bytes32 id = _createNative(1 ether);
        _start(id);
        IFairDrops.Settlement memory s = _settlement(keccak256("root"), 0.5 ether, 1);
        bytes[] memory sigs = _signThreshold(id, s);
        vm.expectRevert(IFairDrops.SeedNotCommitted.selector);
        fd.finalize(id, s, sigs);
    }

    function test_revert_finalize_wrongSeed() public {
        bytes32 id = _createNative(1 ether);
        _commit(id);
        _start(id);
        IFairDrops.Settlement memory s = _settlement(keccak256("root"), 0.5 ether, 1);
        s.seed = keccak256("a different seed");
        bytes[] memory sigs = _signThreshold(id, s);
        vm.expectRevert(IFairDrops.SeedMismatch.selector);
        fd.finalize(id, s, sigs);
    }

    function test_revert_finalize_payoutExceedsPrize() public {
        bytes32 id = _createNative(1 ether);
        _commit(id);
        _start(id);
        IFairDrops.Settlement memory s = _settlement(keccak256("root"), 1 ether, 1);
        bytes[] memory sigs = _signThreshold(id, s);
        vm.expectRevert(IFairDrops.PayoutExceedsPrize.selector);
        fd.finalize(id, s, sigs);
    }

    function test_revert_finalize_malformedSettlement() public {
        bytes32 id = _createNative(1 ether);
        _commit(id);
        _start(id);

        IFairDrops.Settlement memory s = _settlement(bytes32(0), 0.5 ether, 1);
        _expectFinalizeRevert(id, s, IFairDrops.InvalidSettlement.selector);

        s = _settlement(keccak256("root"), 0, 1);
        _expectFinalizeRevert(id, s, IFairDrops.InvalidSettlement.selector);

        s = _settlement(keccak256("root"), 0.5 ether, 0);
        _expectFinalizeRevert(id, s, IFairDrops.InvalidSettlement.selector);

        s = _settlement(keccak256("root"), 0.5 ether, 11);
        _expectFinalizeRevert(id, s, IFairDrops.InvalidSettlement.selector);
    }

    function test_revert_finalize_unauthorizedSigner() public {
        bytes32 id = _createNative(1 ether);
        _commit(id);
        _start(id);
        IFairDrops.Settlement memory s = _settlement(keccak256("root"), 0.5 ether, 1);
        uint256[] memory keys = new uint256[](1);
        keys[0] = 0xBAD;
        bytes[] memory sigs = _sign(id, s, keys);

        vm.expectRevert(
            abi.encodeWithSelector(IFairDrops.UnauthorizedSigner.selector, vm.addr(0xBAD))
        );
        fd.finalize(id, s, sigs);
    }

    function test_revert_finalize_tamperedSettlement() public {
        bytes32 id = _createNative(1 ether);
        _commit(id);
        _start(id);
        IFairDrops.Settlement memory s = _settlement(keccak256("root"), 0.5 ether, 1);
        bytes[] memory sigs = _signThreshold(id, s);
        s.totalPayout = 0.9 ether;

        vm.expectPartialRevert(IFairDrops.UnauthorizedSigner.selector);
        fd.finalize(id, s, sigs);
    }

    function test_revert_finalize_malleableSignature() public {
        bytes32 id = _createNative(1 ether);
        _commit(id);
        _start(id);
        IFairDrops.Settlement memory s = _settlement(keccak256("root"), 0.5 ether, 1);
        (uint8 v, bytes32 r, bytes32 sig) = vm.sign(verifierKeys[0], fd.settlementDigest(id, s));
        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes[] memory sigs = new bytes[](1);
        sigs[0] = abi.encodePacked(r, bytes32(n - uint256(sig)), v == 27 ? uint8(28) : uint8(27));

        vm.expectRevert(
            abi.encodeWithSelector(ECDSA.ECDSAInvalidSignatureS.selector, bytes32(n - uint256(sig)))
        );
        fd.finalize(id, s, sigs);
    }

    function test_revert_finalize_replay() public {
        bytes32 id = _createNative(1 ether);
        Payouts memory p = _payouts(id, _two(alice, bob), _two(0.5 ether, 0.4 ether));
        _commit(id);
        _start(id);
        IFairDrops.Settlement memory s = _settlement(p.root, p.total, 2);
        bytes[] memory sigs = _signThreshold(id, s);
        fd.finalize(id, s, sigs);

        vm.expectRevert(
            abi.encodeWithSelector(IFairDrops.InvalidStatus.selector, IFairDrops.Status.Finalized)
        );
        fd.finalize(id, s, sigs);
    }

    function test_revert_finalize_signatureFromAnotherChain() public {
        bytes32 id = _createNative(1 ether);
        _commit(id);
        _start(id);
        IFairDrops.Settlement memory s = _settlement(keccak256("root"), 0.5 ether, 1);
        bytes[] memory sigs = _signThreshold(id, s);

        vm.chainId(block.chainid + 1);
        vm.expectPartialRevert(IFairDrops.UnauthorizedSigner.selector);
        fd.finalize(id, s, sigs);
    }

    function test_revert_finalize_whilePaused() public {
        bytes32 id = _createNative(1 ether);
        _commit(id);
        _start(id);
        vm.prank(pauser);
        fd.pause();
        IFairDrops.Settlement memory s = _settlement(keccak256("root"), 0.5 ether, 1);
        bytes[] memory sigs = _signThreshold(id, s);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        fd.finalize(id, s, sigs);
    }

    // Threshold signatures

    function test_finalize_meetsThresholdOfTwo() public {
        fd = _deploy(3, 2);
        vm.prank(host);
        bytes32 id = fd.createGiveaway{value: 1 ether}(_params(NATIVE, 1 ether));
        Payouts memory p = _payouts(id, _two(alice, bob), _two(0.5 ether, 0.4 ether));
        _commit(id);
        _start(id);
        IFairDrops.Settlement memory s = _settlement(p.root, p.total, 2);

        uint256[] memory keys = new uint256[](2);
        keys[0] = verifierKeys[2];
        keys[1] = verifierKeys[0];
        fd.finalize(id, s, _sign(id, s, keys));
        assertEq(uint8(fd.getGiveaway(id).status), uint8(IFairDrops.Status.Finalized));
    }

    function test_revert_finalize_belowThreshold() public {
        fd = _deploy(3, 2);
        vm.prank(host);
        bytes32 id = fd.createGiveaway{value: 1 ether}(_params(NATIVE, 1 ether));
        _commit(id);
        _start(id);
        IFairDrops.Settlement memory s = _settlement(keccak256("root"), 0.5 ether, 1);
        uint256[] memory keys = new uint256[](1);
        keys[0] = verifierKeys[0];
        bytes[] memory sigs = _sign(id, s, keys);

        vm.expectRevert(abi.encodeWithSelector(IFairDrops.InsufficientSignatures.selector, 1, 2));
        fd.finalize(id, s, sigs);
    }

    function test_revert_finalize_duplicateSigner() public {
        fd = _deploy(3, 2);
        vm.prank(host);
        bytes32 id = fd.createGiveaway{value: 1 ether}(_params(NATIVE, 1 ether));
        _commit(id);
        _start(id);
        IFairDrops.Settlement memory s = _settlement(keccak256("root"), 0.5 ether, 1);
        uint256[] memory keys = new uint256[](1);
        keys[0] = verifierKeys[0];
        bytes[] memory one = _sign(id, s, keys);
        bytes[] memory sigs = new bytes[](2);
        sigs[0] = one[0];
        sigs[1] = one[0];

        vm.expectRevert(IFairDrops.SignersNotSorted.selector);
        fd.finalize(id, s, sigs);
    }

    function test_revert_finalize_unsortedSigners() public {
        fd = _deploy(3, 2);
        vm.prank(host);
        bytes32 id = fd.createGiveaway{value: 1 ether}(_params(NATIVE, 1 ether));
        _commit(id);
        _start(id);
        IFairDrops.Settlement memory s = _settlement(keccak256("root"), 0.5 ether, 1);
        uint256[] memory keys = new uint256[](2);
        keys[0] = verifierKeys[0];
        keys[1] = verifierKeys[1];
        bytes[] memory sorted = _sign(id, s, keys);
        bytes[] memory reversed = new bytes[](2);
        reversed[0] = sorted[1];
        reversed[1] = sorted[0];

        vm.expectRevert(IFairDrops.SignersNotSorted.selector);
        fd.finalize(id, s, reversed);
    }

    // Claims

    function test_claim_paysWinnersAndRelayerCanClaimForThem() public {
        bytes32 id = _createNative(10 ether);
        Payouts memory p = _finalize(id, _two(alice, bob), _two(6 ether, 3 ether));

        vm.prank(alice);
        fd.claim(id, alice, 6 ether, p.proofs[0]);

        vm.expectEmit(address(fd));
        emit IFairDrops.Claimed(id, bob, bob, 3 ether);
        vm.prank(relayer);
        fd.claim(id, bob, 3 ether, p.proofs[1]);

        assertEq(alice.balance, 6 ether);
        assertEq(bob.balance, 3 ether);
        assertEq(relayer.balance, 0);
        assertTrue(fd.isClaimed(id, alice));
        assertEq(fd.getGiveaway(id).claimed, 9 ether);
        assertEq(fd.liabilities(NATIVE), 1 ether, "remainder and fee stay escrowed");
    }

    function test_claimMany_paysAllWinners() public {
        bytes32 id = _createToken(1000e18);
        address[] memory accounts = new address[](3);
        accounts[0] = alice;
        accounts[1] = bob;
        accounts[2] = carol;
        uint256[] memory amounts = new uint256[](3);
        amounts[0] = 500e18;
        amounts[1] = 300e18;
        amounts[2] = 190e18;
        Payouts memory p = _finalize(id, accounts, amounts);

        IFairDrops.ClaimRequest[] memory requests = new IFairDrops.ClaimRequest[](3);
        for (uint256 i = 0; i < 3; ++i) {
            requests[i] = IFairDrops.ClaimRequest(id, accounts[i], amounts[i], p.proofs[i]);
        }
        vm.prank(relayer);
        fd.claimMany(requests);

        assertEq(token.balanceOf(alice), 500e18);
        assertEq(token.balanceOf(bob), 300e18);
        assertEq(token.balanceOf(carol), 190e18);
        assertEq(fd.getGiveaway(id).claimed, fd.getGiveaway(id).totalPayout);
    }

    function test_revert_claim_twice() public {
        bytes32 id = _createNative(10 ether);
        Payouts memory p = _finalize(id, _two(alice, bob), _two(6 ether, 3 ether));
        fd.claim(id, alice, 6 ether, p.proofs[0]);

        vm.expectRevert(IFairDrops.AlreadyClaimed.selector);
        fd.claim(id, alice, 6 ether, p.proofs[0]);
    }

    function test_revert_claim_inflatedAmount() public {
        bytes32 id = _createNative(10 ether);
        Payouts memory p = _finalize(id, _two(alice, bob), _two(6 ether, 3 ether));
        vm.expectRevert(IFairDrops.InvalidProof.selector);
        fd.claim(id, alice, 7 ether, p.proofs[0]);
    }

    function test_revert_claim_someoneElsesProof() public {
        bytes32 id = _createNative(10 ether);
        Payouts memory p = _finalize(id, _two(alice, bob), _two(6 ether, 3 ether));
        vm.expectRevert(IFairDrops.InvalidProof.selector);
        fd.claim(id, carol, 6 ether, p.proofs[0]);
    }

    function test_revert_claim_proofFromAnotherGiveaway() public {
        bytes32 first = _createNative(10 ether);
        bytes32 second = _createNative(10 ether);
        Payouts memory p = _payouts(first, _two(alice, bob), _two(6 ether, 3 ether));
        Payouts memory q = _payouts(second, _two(carol, bob), _two(6 ether, 3 ether));
        _commit(first);
        _commit(second);
        _start(first);
        IFairDrops.Settlement memory s1 = _settlement(p.root, p.total, 2);
        fd.finalize(first, s1, _signThreshold(first, s1));
        IFairDrops.Settlement memory s2 = _settlement(q.root, q.total, 2);
        fd.finalize(second, s2, _signThreshold(second, s2));

        vm.expectRevert(IFairDrops.InvalidProof.selector);
        fd.claim(second, alice, 6 ether, p.proofs[0]);
    }

    function test_revert_claim_beforeFinalize() public {
        bytes32 id = _createNative(10 ether);
        vm.expectRevert(
            abi.encodeWithSelector(IFairDrops.InvalidStatus.selector, IFairDrops.Status.Active)
        );
        fd.claim(id, alice, 1 ether, new bytes32[](0));
    }

    function test_revert_claim_afterWindow() public {
        bytes32 id = _createNative(10 ether);
        Payouts memory p = _finalize(id, _two(alice, bob), _two(6 ether, 3 ether));
        vm.warp(fd.getGiveaway(id).claimDeadline + 1);

        vm.expectRevert(IFairDrops.ClaimWindowClosed.selector);
        fd.claim(id, alice, 6 ether, p.proofs[0]);
    }

    function test_claim_isCappedAtSignedTotal() public {
        bytes32 id = _createNative(10 ether);
        Payouts memory p = _payouts(id, _two(alice, bob), _two(6 ether, 3 ether));
        _commit(id);
        _start(id);
        // Verifiers sign a total lower than the tree actually pays out.
        IFairDrops.Settlement memory s = _settlement(p.root, 7 ether, 2);
        fd.finalize(id, s, _signThreshold(id, s));

        fd.claim(id, alice, 6 ether, p.proofs[0]);
        vm.expectRevert(IFairDrops.PayoutExceedsPrize.selector);
        fd.claim(id, bob, 3 ether, p.proofs[1]);
    }

    function test_claim_usesWinnerPayoutWallet() public {
        address vault = makeAddr("aliceVault");
        vm.prank(alice);
        fd.setPayoutWallet(vault);
        bytes32 id = _createNative(10 ether);
        Payouts memory p = _finalize(id, _two(alice, bob), _two(6 ether, 3 ether));

        vm.prank(relayer);
        fd.claim(id, alice, 6 ether, p.proofs[0]);
        assertEq(vault.balance, 6 ether);
        assertEq(alice.balance, 0);
    }

    function test_rejectingWinner_doesNotBlockOthers() public {
        address rejecting = address(new RejectingReceiver());
        bytes32 id = _createNative(10 ether);
        Payouts memory p = _finalize(id, _two(rejecting, bob), _two(6 ether, 3 ether));

        vm.expectRevert(IFairDrops.NativeTransferFailed.selector);
        fd.claim(id, rejecting, 6 ether, p.proofs[0]);

        fd.claim(id, bob, 3 ether, p.proofs[1]);
        assertEq(bob.balance, 3 ether);
    }

    function test_revert_setPayoutWallet_toContract() public {
        vm.prank(alice);
        vm.expectRevert(IFairDrops.InvalidPayoutWallet.selector);
        fd.setPayoutWallet(address(fd));
    }

    function test_claim_worksWhilePaused() public {
        bytes32 id = _createNative(10 ether);
        Payouts memory p = _finalize(id, _two(alice, bob), _two(6 ether, 3 ether));
        vm.prank(pauser);
        fd.pause();

        fd.claim(id, alice, 6 ether, p.proofs[0]);
        assertEq(alice.balance, 6 ether);
    }

    function test_revert_claim_reentrancy() public {
        ReentrantToken reentrant = new ReentrantToken();
        reentrant.mint(host, 1000e18);
        vm.startPrank(host);
        reentrant.approve(address(fd), type(uint256).max);
        bytes32 id = fd.createGiveaway(_params(address(reentrant), 1000e18));
        vm.stopPrank();
        Payouts memory p = _finalize(id, _two(alice, bob), _two(500e18, 400e18));

        reentrant.arm(address(fd), abi.encodeCall(FairDrops.claim, (id, bob, 400e18, p.proofs[1])));
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        fd.claim(id, alice, 500e18, p.proofs[0]);
    }

    // Host remainder and unclaimed funds

    function test_hostWithdraw_remainderThenUnclaimedAfterWindow() public {
        bytes32 id = _createNative(10 ether);
        Payouts memory p = _finalize(id, _two(alice, bob), _two(6 ether, 3 ether));
        fd.claim(id, alice, 6 ether, p.proofs[0]);

        assertEq(fd.hostWithdrawable(id), 0.9 ether, "prize minus signed total");
        uint256 before = host.balance;
        vm.prank(host);
        fd.withdraw(id);
        assertEq(host.balance, before + 0.9 ether);

        vm.prank(host);
        vm.expectRevert(IFairDrops.NothingToWithdraw.selector);
        fd.withdraw(id);

        vm.warp(fd.getGiveaway(id).claimDeadline + 1);
        assertEq(fd.hostWithdrawable(id), 3 ether, "bob never claimed");
        vm.prank(host);
        fd.withdraw(id);
        assertEq(host.balance, before + 3.9 ether);
        assertEq(fd.liabilities(NATIVE), 0.1 ether, "only the earned fee remains");
    }

    // Fees

    function test_withdrawFees_paysFeeRecipient() public {
        bytes32 id = _createNative(10 ether);
        _finalize(id, _two(alice, bob), _two(6 ether, 3 ether));

        vm.prank(relayer);
        fd.withdrawFees(NATIVE);
        assertEq(feeRecipient.balance, 0.1 ether);
        assertEq(fd.accruedFees(NATIVE), 0);

        vm.expectRevert(IFairDrops.NothingToWithdraw.selector);
        fd.withdrawFees(NATIVE);
    }

    function test_cancelledGiveaway_accruesNoFee() public {
        bytes32 id = _createNative(10 ether);
        vm.prank(host);
        fd.cancel(id);
        vm.expectRevert(IFairDrops.NothingToWithdraw.selector);
        fd.withdrawFees(NATIVE);
    }

    // Accounting across the full lifecycle

    function testFuzz_fullLifecycle_leavesNoDust(uint96 deposit, uint96 aliceShare, uint96 bobShare)
        public
    {
        uint256 amount = bound(deposit, 1e6, 1e30);
        token.mint(host, amount);
        bytes32 id = _createToken(amount);
        uint256 prize = fd.getGiveaway(id).prize;
        uint256 a = bound(aliceShare, 1, prize - 1);
        uint256 b = bound(bobShare, 1, prize - a);

        Payouts memory p = _finalize(id, _two(alice, bob), _two(a, b));
        fd.claim(id, alice, a, p.proofs[0]);
        vm.warp(fd.getGiveaway(id).claimDeadline + 1);
        vm.prank(host);
        fd.withdraw(id);
        fd.withdrawFees(address(token));

        assertEq(fd.liabilities(address(token)), 0);
        assertEq(token.balanceOf(address(fd)), 0);
    }

    function _expectFinalizeRevert(bytes32 id, IFairDrops.Settlement memory s, bytes4 selector)
        private
    {
        bytes[] memory sigs = _signThreshold(id, s);
        vm.expectRevert(selector);
        fd.finalize(id, s, sigs);
    }
}
