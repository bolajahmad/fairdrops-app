// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

/// @title FairDropsAccount
/// @notice EIP-7702 delegate for the embedded wallets of people who signed in with Google, email
/// or a passkey. Those wallets hold no gas: the owner signs a batch of calls and a relayer
/// submits it to the owner's own address, which runs it with this code. One of the calls pays
/// the relayer its fee, so the owner never needs the network's coin.
/// @dev Runs in the context of the delegating account, so `address(this)` is the owner. Only a
/// signature by that account can run calls, each batch uses the next nonce (kept at a
/// namespaced storage slot, so it can't clash with another delegate's storage), and a batch is
/// void after its deadline. The EIP-712 domain's verifying contract is the account itself.
contract FairDropsAccount is EIP712 {
    struct Call {
        address to;
        uint256 value;
        bytes data;
    }

    bytes32 public constant CALL_TYPEHASH = keccak256("Call(address to,uint256 value,bytes data)");
    bytes32 public constant EXECUTE_TYPEHASH = keccak256(
        "Execute(Call[] calls,uint256 nonce,uint256 deadline)Call(address to,uint256 value,bytes data)"
    );

    /// @dev keccak256(abi.encode(uint256(keccak256("fairdrops.account.nonce")) - 1)) & ~0xff
    bytes32 private constant NONCE_SLOT =
        0x052a01eb51db3d26c70154bf3593ececf8c0c86422f91dd2903e3468f3800a00;

    event Executed(uint256 indexed nonce, uint256 calls);

    error Expired();
    error NotOwner();
    error CallFailed(uint256 index, bytes reason);

    constructor() EIP712("FairDropsAccount", "1") {}

    /// @notice Runs `calls` in order as this account, if the account signed them. Reverts as a
    /// whole if any call fails.
    function execute(Call[] calldata calls, uint256 deadline, bytes calldata signature)
        external
        payable
    {
        if (block.timestamp > deadline) revert Expired();
        uint256 current = nonce();
        bytes32 digest = _hashTypedDataV4(
            keccak256(abi.encode(EXECUTE_TYPEHASH, _hashCalls(calls), current, deadline))
        );
        if (ECDSA.recover(digest, signature) != address(this)) revert NotOwner();
        _setNonce(current + 1);

        for (uint256 i = 0; i < calls.length; ++i) {
            (bool ok, bytes memory reason) = calls[i].to.call{value: calls[i].value}(calls[i].data);
            if (!ok) revert CallFailed(i, reason);
        }
        emit Executed(current, calls.length);
    }

    /// @notice The nonce the next batch must be signed with.
    function nonce() public view returns (uint256 value) {
        bytes32 slot = NONCE_SLOT;
        assembly ("memory-safe") {
            value := sload(slot)
        }
    }

    /// @notice The digest the owner signs for a batch, for clients that check their encoding.
    function executeDigest(Call[] calldata calls, uint256 nonceValue, uint256 deadline)
        external
        view
        returns (bytes32)
    {
        return _hashTypedDataV4(
            keccak256(abi.encode(EXECUTE_TYPEHASH, _hashCalls(calls), nonceValue, deadline))
        );
    }

    /// @notice ERC-1271: once delegated, the account has code, so contracts (FairDrops'
    /// `claimWithSig` among them) check its signatures here. A signature counts if the account's
    /// own key made it, exactly as before delegation.
    function isValidSignature(bytes32 hash, bytes calldata signature)
        external
        view
        returns (bytes4)
    {
        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(hash, signature);
        return err == ECDSA.RecoverError.NoError && signer == address(this)
            ? this.isValidSignature.selector
            : bytes4(0xffffffff);
    }

    receive() external payable {}

    function _hashCalls(Call[] calldata calls) private pure returns (bytes32) {
        bytes32[] memory hashes = new bytes32[](calls.length);
        for (uint256 i = 0; i < calls.length; ++i) {
            hashes[i] = keccak256(
                abi.encode(CALL_TYPEHASH, calls[i].to, calls[i].value, keccak256(calls[i].data))
            );
        }
        return keccak256(abi.encodePacked(hashes));
    }

    function _setNonce(uint256 value) private {
        bytes32 slot = NONCE_SLOT;
        assembly ("memory-safe") {
            sstore(slot, value)
        }
    }
}
