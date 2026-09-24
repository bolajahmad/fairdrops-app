// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock", "MOCK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Burns 1% of every transfer between two non-zero addresses.
contract FeeOnTransferToken is ERC20 {
    constructor() ERC20("Taxed", "TAX") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from == address(0) || to == address(0)) return super._update(from, to, value);
        uint256 tax = value / 100;
        super._update(from, address(0), tax);
        super._update(from, to, value - tax);
    }
}

/// @dev Calls back into `target` with `payload` the next time `target` sends tokens, bubbling
/// any revert so tests can assert on the reentrancy guard.
contract ReentrantToken is ERC20 {
    address public target;
    bytes public payload;
    bool public armed;

    constructor() ERC20("Reentrant", "RE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address target_, bytes calldata payload_) external {
        target = target_;
        payload = payload_;
        armed = true;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (armed && from == target) {
            armed = false;
            (bool ok, bytes memory result) = target.call(payload);
            if (!ok) {
                assembly ("memory-safe") {
                    revert(add(result, 0x20), mload(result))
                }
            }
        }
    }
}

/// @dev Has no receive or fallback, so native transfers to it fail.
contract RejectingReceiver {}
