// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @dev Builds Merkle trees compatible with OpenZeppelin's MerkleProof (sorted-pair hashing). An
/// odd node at the end of a layer is carried up unchanged.
library TestMerkle {
    function root(bytes32[] memory leaves) internal pure returns (bytes32) {
        require(leaves.length > 0, "empty tree");
        bytes32[] memory layer = leaves;
        while (layer.length > 1) {
            layer = _nextLayer(layer);
        }
        return layer[0];
    }

    function proof(bytes32[] memory leaves, uint256 index)
        internal
        pure
        returns (bytes32[] memory)
    {
        bytes32[] memory path = new bytes32[](256);
        uint256 depth = 0;
        bytes32[] memory layer = leaves;
        while (layer.length > 1) {
            uint256 sibling = index ^ 1;
            if (sibling < layer.length) path[depth++] = layer[sibling];
            layer = _nextLayer(layer);
            index /= 2;
        }

        bytes32[] memory result = new bytes32[](depth);
        for (uint256 i = 0; i < depth; ++i) {
            result[i] = path[i];
        }
        return result;
    }

    function _nextLayer(bytes32[] memory layer) private pure returns (bytes32[] memory next) {
        next = new bytes32[]((layer.length + 1) / 2);
        for (uint256 i = 0; i < next.length; ++i) {
            uint256 left = 2 * i;
            next[i] =
                left + 1 < layer.length ? _hashPair(layer[left], layer[left + 1]) : layer[left];
        }
    }

    function _hashPair(bytes32 a, bytes32 b) private pure returns (bytes32) {
        return a < b ? keccak256(abi.encode(a, b)) : keccak256(abi.encode(b, a));
    }
}
