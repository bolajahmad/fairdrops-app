// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {FairDropsAccount} from "../src/FairDropsAccount.sol";

/// @notice Deploys FairDropsAccount, the EIP-7702 delegate for embedded wallets, through the
/// deterministic CREATE2 deployer. It takes no configuration, so the address is the same on every
/// chain. Re-running on a chain where it already exists is a no-op.
contract DeployAccount is Script {
    bytes32 private constant SALT = keccak256("fairdrops.account");

    function run() external returns (FairDropsAccount deployed) {
        address predicted = vm.computeCreate2Address(
            SALT, keccak256(type(FairDropsAccount).creationCode), CREATE2_FACTORY
        );
        if (predicted.code.length > 0) {
            console.log("FairDropsAccount already deployed at", predicted);
            return FairDropsAccount(payable(predicted));
        }
        vm.startBroadcast(_deployerKey());
        deployed = new FairDropsAccount{salt: SALT}();
        vm.stopBroadcast();
        require(address(deployed) == predicted, "unexpected deployment address");
        console.log("FairDropsAccount deployed at", address(deployed));
    }

    /// @dev Accepts the key with or without a 0x prefix, as cast does.
    function _deployerKey() private view returns (uint256) {
        string memory key = vm.envString("DEPLOYER_PRIVATE_KEY");
        bytes memory raw = bytes(key);
        bool prefixed = raw.length >= 2 && raw[0] == "0" && (raw[1] == "x" || raw[1] == "X");
        return vm.parseUint(prefixed ? key : string.concat("0x", key));
    }
}
