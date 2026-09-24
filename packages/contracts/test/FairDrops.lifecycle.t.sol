// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IFairDrops} from "../src/interfaces/IFairDrops.sol";
import {FairDropsTestBase} from "./utils/FairDropsTestBase.sol";

contract FairDropsLifecycleTest is FairDropsTestBase {
    function test_commitSeed_recordsCommitment() public {
        bytes32 id = _createNative(1 ether);
        bytes32 commitment = keccak256(abi.encode(id, SEED));

        vm.expectEmit(address(fd));
        emit IFairDrops.SeedCommitted(id, commitment);
        vm.prank(operator);
        fd.commitSeed(id, commitment);

        assertEq(fd.getGiveaway(id).seedCommitment, commitment);
    }

    function test_revert_commitSeed_notOperator() public {
        bytes32 id = _createNative(1 ether);
        bytes32 role = fd.OPERATOR_ROLE();
        vm.prank(host);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, host, role
            )
        );
        fd.commitSeed(id, keccak256("x"));
    }

    function test_revert_commitSeed_twice() public {
        bytes32 id = _createNative(1 ether);
        _commit(id);
        vm.prank(operator);
        vm.expectRevert(IFairDrops.SeedAlreadyCommitted.selector);
        fd.commitSeed(id, keccak256("other"));
    }

    function test_revert_commitSeed_zero() public {
        bytes32 id = _createNative(1 ether);
        vm.prank(operator);
        vm.expectRevert(IFairDrops.InvalidCommitment.selector);
        fd.commitSeed(id, bytes32(0));
    }

    function test_revert_commitSeed_afterStart() public {
        bytes32 id = _createNative(1 ether);
        _start(id);
        vm.prank(operator);
        vm.expectRevert(IFairDrops.TooLate.selector);
        fd.commitSeed(id, keccak256("x"));
    }

    function test_hostCancel_beforeStart_refundsPrizeAndFee() public {
        bytes32 id = _createNative(10 ether);
        uint256 balanceBefore = host.balance;

        vm.expectEmit(address(fd));
        emit IFairDrops.GiveawayCancelled(id, host);
        vm.expectEmit(address(fd));
        emit IFairDrops.HostWithdrawal(id, host, host, 10 ether);
        vm.prank(host);
        fd.cancel(id);

        assertEq(host.balance, balanceBefore + 10 ether, "fee is refunded too");
        assertEq(uint8(fd.getGiveaway(id).status), uint8(IFairDrops.Status.Cancelled));
        assertEq(fd.liabilities(NATIVE), 0);
        assertEq(address(fd).balance, 0);
    }

    function test_revert_hostCancel_afterStart() public {
        bytes32 id = _createNative(1 ether);
        _start(id);
        vm.prank(host);
        vm.expectRevert(IFairDrops.TooLate.selector);
        fd.cancel(id);
    }

    function test_revert_cancel_stranger() public {
        bytes32 id = _createNative(1 ether);
        vm.prank(alice);
        vm.expectRevert(IFairDrops.NotHost.selector);
        fd.cancel(id);
    }

    function test_operatorCancel_afterStart_hostWithdrawsRefund() public {
        bytes32 id = _createToken(1000e18);
        _start(id);

        vm.prank(operator);
        fd.cancel(id);
        assertEq(token.balanceOf(address(fd)), 1000e18, "operator cancel does not move funds");
        assertEq(fd.hostWithdrawable(id), 1000e18);

        uint256 before = token.balanceOf(host);
        vm.prank(host);
        fd.withdraw(id);
        assertEq(token.balanceOf(host), before + 1000e18);
        assertEq(fd.hostWithdrawable(id), 0);
    }

    function test_revert_cancel_twice() public {
        bytes32 id = _createNative(1 ether);
        vm.prank(host);
        fd.cancel(id);
        vm.prank(operator);
        vm.expectRevert(
            abi.encodeWithSelector(IFairDrops.InvalidStatus.selector, IFairDrops.Status.Cancelled)
        );
        fd.cancel(id);
    }

    function test_withdraw_afterDeadline_expiresAndRefunds() public {
        bytes32 id = _createNative(5 ether);
        _commit(id);
        vm.warp(fd.getGiveaway(id).finalizeDeadline);
        assertEq(fd.hostWithdrawable(id), 0, "still finalizable at the deadline");

        vm.warp(block.timestamp + 1);
        assertEq(fd.hostWithdrawable(id), 5 ether);

        uint256 before = host.balance;
        vm.expectEmit(address(fd));
        emit IFairDrops.GiveawayExpired(id);
        vm.prank(host);
        fd.withdraw(id);

        assertEq(host.balance, before + 5 ether);
        assertEq(uint8(fd.getGiveaway(id).status), uint8(IFairDrops.Status.Expired));
    }

    function test_revert_withdraw_whileActive() public {
        bytes32 id = _createNative(1 ether);
        vm.prank(host);
        vm.expectRevert(IFairDrops.NothingToWithdraw.selector);
        fd.withdraw(id);
    }

    function test_revert_withdraw_notHost() public {
        bytes32 id = _createNative(1 ether);
        vm.prank(alice);
        vm.expectRevert(IFairDrops.NotHost.selector);
        fd.withdraw(id);
    }

    function test_revert_withdraw_twice() public {
        bytes32 id = _createNative(1 ether);
        vm.prank(operator);
        fd.cancel(id);
        vm.startPrank(host);
        fd.withdraw(id);
        vm.expectRevert(IFairDrops.NothingToWithdraw.selector);
        fd.withdraw(id);
        vm.stopPrank();
    }

    function test_withdraw_usesHostPayoutWallet() public {
        address vault = makeAddr("vault");
        vm.prank(host);
        fd.setPayoutWallet(vault);
        bytes32 id = _createNative(1 ether);

        vm.prank(host);
        fd.cancel(id);
        assertEq(vault.balance, 1 ether);
    }

    function test_exitsWorkWhilePaused() public {
        bytes32 cancelled = _createNative(1 ether);
        bytes32 expired = _createNative(2 ether);
        vm.prank(pauser);
        fd.pause();

        vm.prank(host);
        fd.cancel(cancelled);

        vm.warp(fd.getGiveaway(expired).finalizeDeadline + 1);
        vm.prank(host);
        fd.withdraw(expired);

        assertEq(address(fd).balance, 0);
    }
}
