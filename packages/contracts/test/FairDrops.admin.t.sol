// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IAccessControlDefaultAdminRules} from
    "@openzeppelin/contracts/access/extensions/IAccessControlDefaultAdminRules.sol";
import {FairDrops} from "../src/FairDrops.sol";
import {IFairDrops} from "../src/interfaces/IFairDrops.sol";
import {FairDropsTestBase} from "./utils/FairDropsTestBase.sol";

contract FairDropsAdminTest is FairDropsTestBase {
    function test_constructor_setsConfigurationAndRoles() public view {
        assertEq(fd.defaultAdmin(), admin);
        assertEq(fd.defaultAdminDelay(), ADMIN_DELAY);
        assertEq(fd.feeRecipient(), feeRecipient);
        assertEq(fd.feeBps(), FEE_BPS);
        assertEq(fd.claimWindow(), CLAIM_WINDOW);
        assertEq(fd.verifierThreshold(), 1);
        assertTrue(fd.hasRole(fd.VERIFIER_ROLE(), vm.addr(verifierKeys[0])));
        assertTrue(fd.hasRole(fd.OPERATOR_ROLE(), operator));
        assertTrue(fd.hasRole(fd.PAUSER_ROLE(), pauser));
        assertFalse(fd.hasRole(fd.VERIFIER_ROLE(), admin));
    }

    function test_eip712Domain_bindsChainAndContract() public view {
        (, string memory name, string memory version, uint256 chainId, address verifyingContract,,)
        = fd.eip712Domain();
        assertEq(name, "FairDrops");
        assertEq(version, fd.VERSION());
        assertEq(chainId, block.chainid);
        assertEq(verifyingContract, address(fd));
    }

    function test_revert_constructor_invalidConfiguration() public {
        IFairDrops.InitParams memory p = _init();
        p.feeRecipient = address(0);
        vm.expectRevert(IFairDrops.ZeroAddress.selector);
        new FairDrops(p);

        p = _init();
        p.feeBps = 501;
        vm.expectRevert(IFairDrops.FeeTooHigh.selector);
        new FairDrops(p);

        p = _init();
        p.claimWindow = 1 days;
        vm.expectRevert(IFairDrops.InvalidClaimWindow.selector);
        new FairDrops(p);

        p = _init();
        p.verifierThreshold = 0;
        vm.expectRevert(IFairDrops.InvalidThreshold.selector);
        new FairDrops(p);

        p = _init();
        p.verifiers[0] = address(0);
        vm.expectRevert(IFairDrops.ZeroAddress.selector);
        new FairDrops(p);

        p = _init();
        p.admin = address(0);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControlDefaultAdminRules.AccessControlInvalidDefaultAdmin.selector,
                address(0)
            )
        );
        new FairDrops(p);
    }

    function test_setters_enforceBounds() public {
        vm.startPrank(admin);
        vm.expectRevert(IFairDrops.FeeTooHigh.selector);
        fd.setFeeBps(501);
        vm.expectRevert(IFairDrops.ZeroAddress.selector);
        fd.setFeeRecipient(address(0));
        vm.expectRevert(IFairDrops.InvalidClaimWindow.selector);
        fd.setClaimWindow(366 days);
        vm.expectRevert(IFairDrops.InvalidThreshold.selector);
        fd.setVerifierThreshold(0);

        fd.setFeeBps(250);
        fd.setFeeRecipient(alice);
        fd.setClaimWindow(90 days);
        fd.setVerifierThreshold(2);
        vm.stopPrank();

        assertEq(fd.feeBps(), 250);
        assertEq(fd.feeRecipient(), alice);
        assertEq(fd.claimWindow(), 90 days);
        assertEq(fd.verifierThreshold(), 2);
    }

    function test_revert_setters_notAdmin() public {
        bytes memory expected = abi.encodeWithSelector(
            IAccessControl.AccessControlUnauthorizedAccount.selector, operator, bytes32(0)
        );
        vm.startPrank(operator);
        vm.expectRevert(expected);
        fd.setFeeBps(0);
        vm.expectRevert(expected);
        fd.setFeeRecipient(alice);
        vm.expectRevert(expected);
        fd.setClaimWindow(90 days);
        vm.expectRevert(expected);
        fd.setVerifierThreshold(2);
        vm.expectRevert(expected);
        fd.sweep(NATIVE, alice);
        vm.expectRevert(expected);
        fd.unpause();
        vm.stopPrank();
    }

    function test_claimWindowChange_doesNotAffectExistingGiveaways() public {
        bytes32 id = _createNative(1 ether);
        vm.prank(admin);
        fd.setClaimWindow(7 days);
        assertEq(fd.getGiveaway(id).claimWindow, CLAIM_WINDOW);
    }

    function test_pause_onlyPauserPauses_onlyAdminUnpauses() public {
        bytes32 pauserRole = fd.PAUSER_ROLE();
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, alice, pauserRole
            )
        );
        fd.pause();

        vm.prank(pauser);
        fd.pause();
        assertTrue(fd.paused());

        vm.prank(pauser);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, pauser, bytes32(0)
            )
        );
        fd.unpause();

        vm.prank(admin);
        fd.unpause();
        assertFalse(fd.paused());
    }

    function test_adminTransfer_requiresDelayAndAcceptance() public {
        address newAdmin = makeAddr("newAdmin");
        vm.prank(admin);
        fd.beginDefaultAdminTransfer(newAdmin);

        vm.prank(newAdmin);
        vm.expectPartialRevert(
            IAccessControlDefaultAdminRules.AccessControlEnforcedDefaultAdminDelay.selector
        );
        fd.acceptDefaultAdminTransfer();

        vm.warp(block.timestamp + ADMIN_DELAY + 1);
        vm.prank(newAdmin);
        fd.acceptDefaultAdminTransfer();
        assertEq(fd.defaultAdmin(), newAdmin);
    }

    function test_revert_grantDefaultAdminDirectly() public {
        bytes32 adminRole = fd.DEFAULT_ADMIN_ROLE();
        vm.prank(admin);
        vm.expectRevert(
            IAccessControlDefaultAdminRules.AccessControlEnforcedDefaultAdminRules.selector
        );
        fd.grantRole(adminRole, alice);
    }

    function test_adminCanRotateVerifiers() public {
        address newVerifier = makeAddr("newVerifier");
        bytes32 role = fd.VERIFIER_ROLE();
        address oldVerifier = vm.addr(verifierKeys[0]);
        vm.startPrank(admin);
        fd.grantRole(role, newVerifier);
        fd.revokeRole(role, oldVerifier);
        vm.stopPrank();

        assertTrue(fd.hasRole(role, newVerifier));
        assertFalse(fd.hasRole(role, oldVerifier));
    }

    function test_sweep_movesOnlyExcess() public {
        _createToken(1000e18);
        token.mint(address(fd), 5e18);

        vm.prank(admin);
        fd.sweep(address(token), alice);
        assertEq(token.balanceOf(alice), 5e18);
        assertEq(token.balanceOf(address(fd)), 1000e18);

        vm.prank(admin);
        vm.expectRevert(IFairDrops.NothingToWithdraw.selector);
        fd.sweep(address(token), alice);
    }

    function test_sweep_recoversForcedNative() public {
        _createNative(1 ether);
        vm.deal(address(fd), address(fd).balance + 0.5 ether);

        vm.prank(admin);
        fd.sweep(NATIVE, alice);
        assertEq(alice.balance, 0.5 ether);
        assertEq(address(fd).balance, 1 ether);
    }

    function test_revert_directNativeTransfer() public {
        vm.deal(alice, 1 ether);
        vm.prank(alice);
        (bool ok,) = address(fd).call{value: 1 ether}("");
        assertFalse(ok);
    }

    function _init() private view returns (IFairDrops.InitParams memory p) {
        address[] memory verifiers = new address[](1);
        verifiers[0] = vm.addr(verifierKeys[0]);
        p = IFairDrops.InitParams({
            admin: admin,
            adminTransferDelay: ADMIN_DELAY,
            feeRecipient: feeRecipient,
            feeBps: FEE_BPS,
            claimWindow: CLAIM_WINDOW,
            verifierThreshold: 1,
            verifiers: verifiers,
            operators: new address[](0),
            pausers: new address[](0)
        });
    }
}
