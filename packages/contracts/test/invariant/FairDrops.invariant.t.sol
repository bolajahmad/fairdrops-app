// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {IFairDrops} from "../../src/interfaces/IFairDrops.sol";
import {FairDropsTestBase} from "../utils/FairDropsTestBase.sol";
import {FairDropsHandler} from "./FairDropsHandler.sol";

contract FairDropsInvariantTest is StdInvariant, FairDropsTestBase {
    FairDropsHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new FairDropsHandler(fd, token, operator, verifierKeys[0]);
        targetContract(address(handler));
    }

    /// @dev Nothing is ever donated in these runs, so the balance must match what is owed exactly.
    function invariant_balanceEqualsLiabilities() public view {
        assertEq(address(fd).balance, fd.liabilities(NATIVE));
        assertEq(token.balanceOf(address(fd)), fd.liabilities(address(token)));
    }

    /// @dev Rebuilds liabilities from per-giveaway state: every escrow minus what left it.
    function invariant_liabilitiesMatchGiveawayLedger() public view {
        uint256 nativeOwed;
        uint256 tokenOwed;
        for (uint256 i = 0; i < handler.idCount(); ++i) {
            IFairDrops.Giveaway memory g = fd.getGiveaway(handler.ids(i));
            uint256 outstanding = g.prize + g.fee - g.claimed - g.withdrawn;
            if (g.token == NATIVE) nativeOwed += outstanding;
            else tokenOwed += outstanding;
        }
        assertEq(nativeOwed - handler.feesWithdrawn(NATIVE), fd.liabilities(NATIVE));
        assertEq(tokenOwed - handler.feesWithdrawn(address(token)), fd.liabilities(address(token)));
    }

    function invariant_perGiveawayBounds() public view {
        for (uint256 i = 0; i < handler.idCount(); ++i) {
            IFairDrops.Giveaway memory g = fd.getGiveaway(handler.ids(i));
            assertLe(g.claimed, g.totalPayout, "claims never exceed the signed total");
            assertLe(g.totalPayout, g.prize, "signed total never exceeds the prize");
            assertLe(g.withdrawn, g.prize + g.fee, "host never withdraws more than deposited");
            if (g.status == IFairDrops.Status.Finalized) {
                assertLe(g.withdrawn, g.prize - g.claimed, "host cannot take earned fees");
            }
        }
    }

    function invariant_accruedFeesAreCovered() public view {
        assertLe(fd.accruedFees(NATIVE), fd.liabilities(NATIVE));
        assertLe(fd.accruedFees(address(token)), fd.liabilities(address(token)));
    }
}
