// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IFairDrops
/// @notice Types, events and errors of the FairDrops giveaway escrow.
interface IFairDrops {
    enum Status {
        None,
        Active,
        Finalized,
        Cancelled,
        Expired
    }

    /// @dev `prize` and `fee` are escrowed separately. The fee is only earned on finalization and
    /// is refunded to the host with the prize if the giveaway is cancelled or expires.
    struct Giveaway {
        address host;
        uint64 startTime;
        uint32 maxWinners;
        address token;
        uint64 finalizeDeadline;
        uint16 feeBps;
        Status status;
        uint64 claimDeadline;
        uint32 claimWindow;
        uint32 winnerCount;
        uint256 prize;
        uint256 fee;
        uint256 totalPayout;
        uint256 claimed;
        uint256 withdrawn;
        bytes32 metadataHash;
        bytes32 seedCommitment;
        bytes32 payoutRoot;
        bytes32 transcriptHash;
    }

    struct CreateParams {
        address token;
        uint256 amount;
        uint64 startTime;
        uint64 finalizeDeadline;
        uint32 maxWinners;
        bytes metadata;
    }

    /// @notice The result of a game, signed by the verifiers as EIP-712 typed data.
    /// @param payoutRoot Merkle root over leaves `keccak256(keccak256(abi.encode(id, account, amount)))`.
    /// @param seed Preimage of the committed seed: `keccak256(abi.encode(id, seed)) == seedCommitment`.
    /// @param transcriptHash Hash of the published game transcript used to replay the result.
    struct Settlement {
        bytes32 payoutRoot;
        uint256 totalPayout;
        uint32 winnerCount;
        bytes32 seed;
        bytes32 transcriptHash;
    }

    struct ClaimRequest {
        bytes32 id;
        address account;
        uint256 amount;
        bytes32[] proof;
    }

    /// @notice A signed go-ahead from an account for one relayed action. `nonce` must be the
    /// account's next nonce and the action must land by `deadline` (unix seconds). The signature is
    /// EIP-712 over the action's typed data, from the account itself (or ERC-1271 for contracts).
    struct Authorization {
        uint256 nonce;
        uint256 deadline;
        bytes signature;
    }

    /// @notice An EIP-2612 permit letting the contract pull the host's tokens without a separate
    /// approval transaction. A zero `deadline` means no permit: the allowance must already exist.
    struct Permit {
        uint256 value;
        uint256 deadline;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    struct InitParams {
        address admin;
        uint48 adminTransferDelay;
        address feeRecipient;
        uint16 feeBps;
        uint32 claimWindow;
        uint8 verifierThreshold;
        address[] verifiers;
        address[] operators;
        address[] pausers;
        /// Accounts that may collect prizes for winners and keep a capped fee for the gas.
        address[] relayers;
    }

    event GiveawayCreated(
        bytes32 indexed id,
        address indexed host,
        address indexed token,
        uint256 prize,
        uint256 fee,
        uint64 startTime,
        uint64 finalizeDeadline,
        uint32 maxWinners,
        uint32 claimWindow,
        bytes32 metadataHash,
        bytes metadata
    );
    event FundsAdded(
        bytes32 indexed id, address indexed from, uint256 prizeAdded, uint256 feeAdded
    );
    event SeedCommitted(bytes32 indexed id, bytes32 commitment);
    event GiveawayFinalized(
        bytes32 indexed id,
        bytes32 payoutRoot,
        uint256 totalPayout,
        uint32 winnerCount,
        bytes32 seed,
        bytes32 transcriptHash,
        uint64 claimDeadline
    );
    event GiveawayCancelled(bytes32 indexed id, address indexed by);
    event GiveawayExpired(bytes32 indexed id);
    event Claimed(
        bytes32 indexed id, address indexed account, address indexed recipient, uint256 amount
    );
    event HostWithdrawal(
        bytes32 indexed id, address indexed host, address indexed recipient, uint256 amount
    );
    event PayoutWalletSet(address indexed account, address indexed wallet);
    /// @notice A relayer paid the gas for `account`'s action and kept `fee`, in the giveaway's
    /// token, out of what `account` was owed or deposited.
    event RelayFeePaid(
        bytes32 indexed id, address indexed account, address indexed relayer, uint256 fee
    );
    event FeesWithdrawn(address indexed token, address indexed recipient, uint256 amount);
    event Swept(address indexed token, address indexed to, uint256 amount);
    event FeeBpsUpdated(uint16 feeBps);
    event FeeRecipientUpdated(address feeRecipient);
    event ClaimWindowUpdated(uint32 claimWindow);
    event VerifierThresholdUpdated(uint8 threshold);

    error ZeroAddress();
    error InvalidAmount();
    error InvalidToken();
    error IncorrectNativeValue(uint256 expected, uint256 actual);
    error UnexpectedNativeValue();
    error InvalidSchedule();
    error InvalidWinnerCount();
    error MetadataTooLarge();
    error InvalidStatus(Status status);
    error NotHost();
    error TooEarly();
    error TooLate();
    error InvalidCommitment();
    error SeedAlreadyCommitted();
    error SeedNotCommitted();
    error SeedMismatch();
    error InvalidSettlement();
    error PayoutExceedsPrize();
    error InsufficientSignatures(uint256 provided, uint256 required);
    error SignersNotSorted();
    error UnauthorizedSigner(address signer);
    error ClaimWindowClosed();
    error AlreadyClaimed();
    error InvalidProof();
    error NothingToWithdraw();
    error NativeTransferFailed();
    error FeeTooHigh();
    error InvalidClaimWindow();
    error InvalidThreshold();
    error InvalidPayoutWallet();
    error SignatureExpired();
    error InvalidSignature();
    error LengthMismatch();
}
