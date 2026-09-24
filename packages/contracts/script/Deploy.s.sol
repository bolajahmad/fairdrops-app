// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {FairDrops} from "../src/FairDrops.sol";
import {IFairDrops} from "../src/interfaces/IFairDrops.sol";

/// @notice Deploys FairDrops through the deterministic CREATE2 deployer, so identical
/// configuration yields the same address on every chain. Re-running on a chain where the
/// contract already exists is a no-op.
/// @dev Configuration comes from the environment (see packages/contracts/.env.example). Role
/// lists are comma-separated and their order is part of the init code, so keep it identical
/// across chains.
contract Deploy is Script {
    function run() external returns (FairDrops deployed) {
        (bytes32 salt, IFairDrops.InitParams memory params) = _config();
        address predicted = _predict(salt, params);

        if (predicted.code.length > 0) {
            console.log("FairDrops already deployed at", predicted);
            return FairDrops(predicted);
        }

        vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
        deployed = new FairDrops{salt: salt}(params);
        vm.stopBroadcast();

        require(address(deployed) == predicted, "unexpected deployment address");
        console.log("FairDrops deployed at", address(deployed));
    }

    /// @notice Prints the address the current configuration deploys to, without broadcasting.
    function predict() external view returns (address) {
        (bytes32 salt, IFairDrops.InitParams memory params) = _config();
        return _predict(salt, params);
    }

    function _predict(bytes32 salt, IFairDrops.InitParams memory params)
        private
        pure
        returns (address)
    {
        bytes memory initCode = abi.encodePacked(type(FairDrops).creationCode, abi.encode(params));
        return vm.computeCreate2Address(salt, keccak256(initCode), CREATE2_FACTORY);
    }

    function _config() private view returns (bytes32 salt, IFairDrops.InitParams memory params) {
        salt = vm.envOr("FAIRDROPS_SALT", keccak256("fairdrops.v1"));
        address admin = vm.envAddress("FAIRDROPS_ADMIN");
        params = IFairDrops.InitParams({
            admin: admin,
            adminTransferDelay: uint48(vm.envOr("FAIRDROPS_ADMIN_DELAY", uint256(2 days))),
            feeRecipient: vm.envOr("FAIRDROPS_FEE_RECIPIENT", admin),
            feeBps: uint16(vm.envOr("FAIRDROPS_FEE_BPS", uint256(100))),
            claimWindow: uint32(vm.envOr("FAIRDROPS_CLAIM_WINDOW", uint256(30 days))),
            verifierThreshold: uint8(vm.envOr("FAIRDROPS_VERIFIER_THRESHOLD", uint256(1))),
            verifiers: vm.envAddress("FAIRDROPS_VERIFIERS", ","),
            operators: vm.envAddress("FAIRDROPS_OPERATORS", ","),
            pausers: vm.envOr("FAIRDROPS_PAUSERS", ",", new address[](0))
        });
    }
}
