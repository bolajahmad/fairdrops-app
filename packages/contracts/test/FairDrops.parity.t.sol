// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {FairDrops} from "../src/FairDrops.sol";
import {IFairDrops} from "../src/interfaces/IFairDrops.sol";

/// @notice Checks the contract against `test/fixtures/settlement-parity.json`, which
/// the settlement package generates from its TypeScript implementation (and checks on its side):
/// payout leaves, Merkle proofs, the EIP-712 settlement digest and a verifier signature. A
/// mismatch here means the off-chain settlement would produce claims or signatures the contract
/// rejects.
contract FairDropsParityTest is Test {
    using stdJson for string;

    string internal json;
    FairDrops internal fd;
    bytes32 internal id;

    function setUp() public {
        json = vm.readFile(string.concat(vm.projectRoot(), "/test/fixtures/settlement-parity.json"));
        id = json.readBytes32(".giveawayId");

        // The digest binds the chain id and the contract address, so deploy exactly there.
        vm.chainId(json.readUint(".chainId"));
        address[] memory none = new address[](0);
        deployCodeTo(
            "FairDrops.sol:FairDrops",
            abi.encode(
                IFairDrops.InitParams({
                    admin: makeAddr("admin"),
                    adminTransferDelay: 2 days,
                    feeRecipient: makeAddr("feeRecipient"),
                    feeBps: 100,
                    claimWindow: 30 days,
                    verifierThreshold: 1,
                    verifiers: none,
                    operators: none,
                    pausers: none
                })
            ),
            json.readAddress(".contract")
        );
        fd = FairDrops(payable(json.readAddress(".contract")));
    }

    function test_PayoutLeavesAndProofsMatch() public view {
        bytes32 root = json.readBytes32(".root");
        uint256 count;
        for (uint256 i = 0; vm.keyExistsJson(json, _payout(i, "")); ++i) {
            address account = json.readAddress(_payout(i, ".account"));
            uint256 amount = vm.parseUint(json.readString(_payout(i, ".amount")));
            bytes32 leaf = json.readBytes32(_payout(i, ".leaf"));
            bytes32[] memory proof = json.readBytes32Array(_payout(i, ".proof"));

            assertEq(fd.payoutLeaf(id, account, amount), leaf, "leaf");
            assertTrue(MerkleProof.verify(proof, root, leaf), "proof");
            assertFalse(MerkleProof.verify(proof, root, fd.payoutLeaf(id, account, amount + 1)));
            ++count;
        }
        assertEq(count, 5, "fixture payouts");
    }

    function test_SettlementDigestAndSignatureMatch() public view {
        IFairDrops.Settlement memory s = IFairDrops.Settlement({
            payoutRoot: json.readBytes32(".settlement.payoutRoot"),
            totalPayout: vm.parseUint(json.readString(".settlement.totalPayout")),
            winnerCount: uint32(json.readUint(".settlement.winnerCount")),
            seed: json.readBytes32(".settlement.seed"),
            transcriptHash: json.readBytes32(".settlement.transcriptHash")
        });
        bytes32 digest = fd.settlementDigest(id, s);

        assertEq(digest, json.readBytes32(".digest"), "digest");
        assertEq(
            ECDSA.recover(digest, json.readBytes(".signature")),
            json.readAddress(".verifier"),
            "signer"
        );
    }

    function _payout(uint256 i, string memory field) private pure returns (string memory) {
        return string.concat(".payouts[", vm.toString(i), "]", field);
    }
}
