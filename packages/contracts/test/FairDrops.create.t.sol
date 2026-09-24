// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {FairDrops} from "../src/FairDrops.sol";
import {IFairDrops} from "../src/interfaces/IFairDrops.sol";
import {FairDropsTestBase} from "./utils/FairDropsTestBase.sol";
import {FeeOnTransferToken} from "./utils/Mocks.sol";

contract FairDropsCreateTest is FairDropsTestBase {
    function test_createNative_escrowsPrizeAndFee() public {
        bytes32 id = _createNative(10 ether);

        IFairDrops.Giveaway memory g = fd.getGiveaway(id);
        assertEq(g.host, host);
        assertEq(g.token, NATIVE);
        assertEq(g.prize, 9.9 ether);
        assertEq(g.fee, 0.1 ether);
        assertEq(g.feeBps, FEE_BPS);
        assertEq(g.claimWindow, CLAIM_WINDOW);
        assertEq(uint8(g.status), uint8(IFairDrops.Status.Active));
        assertEq(g.metadataHash, keccak256(bytes('{"title":"Test giveaway"}')));
        assertEq(address(fd).balance, 10 ether);
        assertEq(fd.liabilities(NATIVE), 10 ether);
        assertEq(fd.accruedFees(NATIVE), 0, "fee is not earned until finalization");
    }

    function test_createToken_escrowsPrizeAndFee() public {
        bytes32 id = _createToken(1000e18);

        IFairDrops.Giveaway memory g = fd.getGiveaway(id);
        assertEq(g.prize, 990e18);
        assertEq(g.fee, 10e18);
        assertEq(token.balanceOf(address(fd)), 1000e18);
        assertEq(fd.liabilities(address(token)), 1000e18);
    }

    function test_createGiveaway_emitsFullParameters() public {
        IFairDrops.CreateParams memory p = _params(NATIVE, 1 ether);
        bytes32 expectedId = keccak256(abi.encode(block.chainid, address(fd), uint256(1)));

        vm.expectEmit(address(fd));
        emit IFairDrops.GiveawayCreated(
            expectedId,
            host,
            NATIVE,
            0.99 ether,
            0.01 ether,
            p.startTime,
            p.finalizeDeadline,
            p.maxWinners,
            CLAIM_WINDOW,
            keccak256(p.metadata),
            p.metadata
        );
        vm.prank(host);
        fd.createGiveaway{value: 1 ether}(p);
    }

    function test_ids_areUniqueAndBoundToChainAndContract() public {
        bytes32 first = _createNative(1 ether);
        bytes32 second = _createNative(1 ether);
        assertTrue(first != second);

        FairDrops other = _deploy(1, 1);
        vm.prank(host);
        bytes32 otherId = other.createGiveaway{value: 1 ether}(_params(NATIVE, 1 ether));
        assertTrue(otherId != first, "same counter on another deployment yields another id");

        vm.chainId(999);
        vm.prank(host);
        bytes32 otherChainId = other.createGiveaway{value: 1 ether}(_params(NATIVE, 1 ether));
        assertEq(otherChainId, keccak256(abi.encode(uint256(999), address(other), uint256(2))));
    }

    function test_feeOnTransferToken_escrowsAmountReceived() public {
        FeeOnTransferToken taxed = new FeeOnTransferToken();
        taxed.mint(host, 1000e18);
        vm.startPrank(host);
        taxed.approve(address(fd), type(uint256).max);
        bytes32 id = fd.createGiveaway(_params(address(taxed), 1000e18));
        vm.stopPrank();

        IFairDrops.Giveaway memory g = fd.getGiveaway(id);
        assertEq(g.prize + g.fee, 990e18, "1% transfer tax is not counted as escrow");
        assertEq(fd.liabilities(address(taxed)), taxed.balanceOf(address(fd)));
    }

    function test_revert_nativeValueMismatch() public {
        IFairDrops.CreateParams memory p = _params(NATIVE, 1 ether);
        vm.prank(host);
        vm.expectRevert(
            abi.encodeWithSelector(IFairDrops.IncorrectNativeValue.selector, 1 ether, 0.5 ether)
        );
        fd.createGiveaway{value: 0.5 ether}(p);
    }

    function test_revert_nativeValueSentWithToken() public {
        IFairDrops.CreateParams memory p = _params(address(token), 1e18);
        vm.prank(host);
        vm.expectRevert(IFairDrops.UnexpectedNativeValue.selector);
        fd.createGiveaway{value: 1}(p);
    }

    function test_revert_zeroAmount() public {
        IFairDrops.CreateParams memory p = _params(NATIVE, 0);
        vm.prank(host);
        vm.expectRevert(IFairDrops.InvalidAmount.selector);
        fd.createGiveaway(p);
    }

    function test_revert_tokenWithoutCode() public {
        IFairDrops.CreateParams memory p = _params(makeAddr("eoa"), 1e18);
        vm.prank(host);
        vm.expectRevert(IFairDrops.InvalidToken.selector);
        fd.createGiveaway(p);
    }

    function test_revert_invalidSchedule() public {
        IFairDrops.CreateParams memory p = _params(NATIVE, 1 ether);

        p.startTime = uint64(block.timestamp + fd.MIN_START_DELAY() - 1);
        p.finalizeDeadline = p.startTime + 1 days;
        _expectCreateRevert(p, IFairDrops.InvalidSchedule.selector);

        p.startTime = uint64(block.timestamp + fd.MAX_START_DELAY() + 1);
        p.finalizeDeadline = p.startTime + 1 days;
        _expectCreateRevert(p, IFairDrops.InvalidSchedule.selector);

        p.startTime = uint64(block.timestamp + 1 hours);
        p.finalizeDeadline = p.startTime;
        _expectCreateRevert(p, IFairDrops.InvalidSchedule.selector);

        p.finalizeDeadline = p.startTime + fd.MIN_GAME_WINDOW() - 1;
        _expectCreateRevert(p, IFairDrops.InvalidSchedule.selector);

        p.finalizeDeadline = p.startTime + fd.MAX_GAME_WINDOW() + 1;
        _expectCreateRevert(p, IFairDrops.InvalidSchedule.selector);
    }

    function test_revert_invalidWinnerCount() public {
        IFairDrops.CreateParams memory p = _params(NATIVE, 1 ether);
        p.maxWinners = 0;
        _expectCreateRevert(p, IFairDrops.InvalidWinnerCount.selector);
        p.maxWinners = fd.MAX_WINNERS() + 1;
        _expectCreateRevert(p, IFairDrops.InvalidWinnerCount.selector);
    }

    function test_revert_metadataTooLarge() public {
        IFairDrops.CreateParams memory p = _params(NATIVE, 1 ether);
        p.metadata = new bytes(fd.MAX_METADATA_BYTES() + 1);
        _expectCreateRevert(p, IFairDrops.MetadataTooLarge.selector);
    }

    function test_revert_createWhilePaused() public {
        vm.prank(pauser);
        fd.pause();
        IFairDrops.CreateParams memory p = _params(NATIVE, 1 ether);
        _expectCreateRevert(p, Pausable.EnforcedPause.selector);
    }

    function test_addFunds_increasesPrizeAndFee() public {
        bytes32 id = _createNative(1 ether);

        vm.expectEmit(address(fd));
        emit IFairDrops.FundsAdded(id, host, 0.99 ether, 0.01 ether);
        vm.prank(host);
        fd.addFunds{value: 1 ether}(id, 1 ether);

        IFairDrops.Giveaway memory g = fd.getGiveaway(id);
        assertEq(g.prize, 1.98 ether);
        assertEq(g.fee, 0.02 ether);
        assertEq(fd.liabilities(NATIVE), 2 ether);
    }

    function test_addFunds_usesSnapshottedFee() public {
        bytes32 id = _createNative(1 ether);
        vm.prank(admin);
        fd.setFeeBps(500);

        vm.prank(host);
        fd.addFunds{value: 1 ether}(id, 1 ether);
        assertEq(fd.getGiveaway(id).fee, 0.02 ether);
    }

    function test_revert_addFunds_notHost() public {
        bytes32 id = _createNative(1 ether);
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        vm.expectRevert(IFairDrops.NotHost.selector);
        fd.addFunds{value: 1 ether}(id, 1 ether);
    }

    function test_revert_addFunds_afterStart() public {
        bytes32 id = _createNative(1 ether);
        _start(id);
        vm.prank(host);
        vm.expectRevert(IFairDrops.TooLate.selector);
        fd.addFunds{value: 1 ether}(id, 1 ether);
    }

    function test_revert_addFunds_unknownGiveaway() public {
        vm.prank(host);
        vm.expectRevert(
            abi.encodeWithSelector(IFairDrops.InvalidStatus.selector, IFairDrops.Status.None)
        );
        fd.addFunds{value: 1 ether}(bytes32(uint256(1)), 1 ether);
    }

    function testFuzz_feeSplit_conservesDeposit(uint256 amount, uint16 bps) public {
        amount = bound(amount, 1, 1e36);
        bps = uint16(bound(bps, 0, fd.MAX_FEE_BPS()));
        vm.prank(admin);
        fd.setFeeBps(bps);
        token.mint(host, amount);

        bytes32 id = _createToken(amount);

        IFairDrops.Giveaway memory g = fd.getGiveaway(id);
        assertEq(g.prize + g.fee, amount);
        assertLe(g.fee, amount * fd.MAX_FEE_BPS() / 10_000);
        assertEq(fd.liabilities(address(token)), amount);
    }

    function _expectCreateRevert(IFairDrops.CreateParams memory p, bytes4 selector) private {
        vm.prank(host);
        vm.expectRevert(selector);
        fd.createGiveaway{value: p.token == NATIVE ? p.amount : 0}(p);
    }
}
