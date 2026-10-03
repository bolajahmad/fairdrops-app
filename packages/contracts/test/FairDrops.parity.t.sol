// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {stdJson} from "forge-std/StdJson.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {FairDrops} from "../src/FairDrops.sol";
import {FairDropsAccount} from "../src/FairDropsAccount.sol";
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
                    pausers: none,
                    relayers: none
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

    /// @dev Signed actions: the digests TypeScript signs must be the ones the contract checks.
    function test_RelayTypehashesMatch() public view {
        bytes32 domain = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256("FairDrops"),
                keccak256("1"),
                block.chainid,
                address(fd)
            )
        );

        bytes32 claimTo = keccak256(
            abi.encode(
                fd.CLAIM_TO_TYPEHASH(),
                json.readBytes32(".relay.claimTo.giveawayId"),
                json.readAddress(".relay.claimTo.account"),
                _uint(".relay.claimTo.amount"),
                json.readAddress(".relay.claimTo.recipient"),
                _uint(".relay.claimTo.fee"),
                _uint(".relay.claimTo.nonce"),
                _uint(".relay.claimTo.deadline")
            )
        );
        assertEq(_digest(domain, claimTo), json.readBytes32(".relay.claimTo.digest"), "ClaimTo");

        bytes32 withdrawTo = keccak256(
            abi.encode(
                fd.WITHDRAW_TO_TYPEHASH(),
                json.readBytes32(".relay.withdrawTo.giveawayId"),
                json.readAddress(".relay.withdrawTo.host"),
                json.readAddress(".relay.withdrawTo.recipient"),
                _uint(".relay.withdrawTo.fee"),
                _uint(".relay.withdrawTo.nonce"),
                _uint(".relay.withdrawTo.deadline")
            )
        );
        assertEq(
            _digest(domain, withdrawTo), json.readBytes32(".relay.withdrawTo.digest"), "WithdrawTo"
        );

        bytes32 payoutWallet = keccak256(
            abi.encode(
                fd.PAYOUT_WALLET_TYPEHASH(),
                json.readAddress(".relay.setPayoutWallet.account"),
                json.readAddress(".relay.setPayoutWallet.wallet"),
                _uint(".relay.setPayoutWallet.nonce"),
                _uint(".relay.setPayoutWallet.deadline")
            )
        );
        assertEq(
            _digest(domain, payoutWallet),
            json.readBytes32(".relay.setPayoutWallet.digest"),
            "SetPayoutWallet"
        );

        assertEq(
            _digest(domain, _createHash()),
            json.readBytes32(".relay.createGiveaway.digest"),
            "CreateGiveaway"
        );
    }

    /// @dev Split out to keep the stack shallow.
    function _createHash() private view returns (bytes32) {
        return keccak256(
            abi.encode(
                fd.CREATE_GIVEAWAY_TYPEHASH(),
                json.readAddress(".relay.createGiveaway.host"),
                json.readAddress(".relay.createGiveaway.token"),
                _uint(".relay.createGiveaway.amount"),
                uint64(_uint(".relay.createGiveaway.startTime")),
                uint64(_uint(".relay.createGiveaway.finalizeDeadline")),
                uint32(_uint(".relay.createGiveaway.maxWinners")),
                json.readBytes32(".relay.createGiveaway.metadataHash"),
                _uint(".relay.createGiveaway.relayFee"),
                _uint(".relay.createGiveaway.nonce"),
                _uint(".relay.createGiveaway.deadline")
            )
        );
    }

    /// @dev An embedded wallet's batch: FairDropsAccount, running at the wallet's address, must
    /// compute the digest TypeScript signs.
    function test_AccountExecuteDigestMatches() public {
        address account = json.readAddress(".relay.execute.account");
        deployCodeTo("FairDropsAccount.sol:FairDropsAccount", account);

        FairDropsAccount.Call[] memory calls = new FairDropsAccount.Call[](2);
        for (uint256 i = 0; i < calls.length; ++i) {
            string memory at = string.concat(".relay.execute.calls[", vm.toString(i), "]");
            calls[i] = FairDropsAccount.Call({
                to: json.readAddress(string.concat(at, ".to")),
                value: vm.parseUint(json.readString(string.concat(at, ".value"))),
                data: json.readBytes(string.concat(at, ".data"))
            });
        }
        assertEq(
            FairDropsAccount(payable(account)).executeDigest(
                calls, _uint(".relay.execute.nonce"), _uint(".relay.execute.deadline")
            ),
            json.readBytes32(".relay.execute.digest"),
            "Execute"
        );
    }

    function _uint(string memory key) private view returns (uint256) {
        return vm.parseUint(json.readString(key));
    }

    function _digest(bytes32 domain, bytes32 structHash) private pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", domain, structHash));
    }

    function _payout(uint256 i, string memory field) private pure returns (string memory) {
        return string.concat(".payouts[", vm.toString(i), "]", field);
    }
}
