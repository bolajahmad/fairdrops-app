// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControlDefaultAdminRules} from
    "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IFairDrops} from "./interfaces/IFairDrops.sol";

/// @title FairDrops
/// @notice Chain-agnostic escrow for giveaways decided off-chain by verifiable games.
/// @dev Hosts escrow a prize. An operator commits to a random seed before the game starts. After
/// the game, a threshold of verifiers signs a Settlement (EIP-712) holding a Merkle root of
/// payouts, the revealed seed and a transcript hash. Winners, or anyone on their behalf, claim
/// against the root. Every outflow is pull-based, and exits (claim, cancel, withdraw) keep working
/// while the contract is paused.
contract FairDrops is
    IFairDrops,
    AccessControlDefaultAdminRules,
    Pausable,
    ReentrancyGuard,
    EIP712
{
    using SafeERC20 for IERC20;

    string public constant VERSION = "1";

    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    bytes32 public constant SETTLEMENT_TYPEHASH = keccak256(
        "Settlement(bytes32 giveawayId,bytes32 payoutRoot,uint256 totalPayout,uint32 winnerCount,bytes32 seed,bytes32 transcriptHash)"
    );

    address public constant NATIVE_TOKEN = address(0);
    uint16 public constant MAX_FEE_BPS = 500;
    uint32 public constant MAX_WINNERS = 100_000;
    uint256 public constant MAX_METADATA_BYTES = 4096;
    uint64 public constant MIN_START_DELAY = 2 minutes;
    uint64 public constant MAX_START_DELAY = 180 days;
    uint64 public constant MIN_GAME_WINDOW = 10 minutes;
    uint64 public constant MAX_GAME_WINDOW = 30 days;
    uint32 public constant MIN_CLAIM_WINDOW = 7 days;
    uint32 public constant MAX_CLAIM_WINDOW = 365 days;

    uint16 private constant _BPS_DENOMINATOR = 10_000;

    uint16 public feeBps;
    uint8 public verifierThreshold;
    uint32 public claimWindow;
    address public feeRecipient;
    uint256 public giveawayCount;

    /// @notice Amount of each token the contract owes to hosts, winners and the fee recipient.
    mapping(address token => uint256) public liabilities;
    /// @notice Fees earned by finalized giveaways and not yet withdrawn.
    mapping(address token => uint256) public accruedFees;
    /// @notice Optional redirect for funds owed to an account.
    mapping(address account => address) public payoutWallet;
    mapping(bytes32 id => mapping(address account => bool)) public isClaimed;

    mapping(bytes32 id => Giveaway) private _giveaways;

    constructor(InitParams memory p)
        AccessControlDefaultAdminRules(p.adminTransferDelay, p.admin)
        EIP712("FairDrops", VERSION)
    {
        _setFeeRecipient(p.feeRecipient);
        _setFeeBps(p.feeBps);
        _setClaimWindow(p.claimWindow);
        _setVerifierThreshold(p.verifierThreshold);
        _grantAll(VERIFIER_ROLE, p.verifiers);
        _grantAll(OPERATOR_ROLE, p.operators);
        _grantAll(PAUSER_ROLE, p.pausers);
    }

    // Hosts

    /// @notice Escrows a prize and opens a giveaway. The fee is escrowed alongside and only earned
    /// if the giveaway is finalized.
    /// @dev For ERC-20 prizes the escrowed amount is the balance actually received, so
    /// fee-on-transfer tokens are accounted correctly. Rebasing tokens are not supported.
    function createGiveaway(CreateParams calldata p)
        external
        payable
        whenNotPaused
        nonReentrant
        returns (bytes32 id)
    {
        _validateSchedule(p.startTime, p.finalizeDeadline);
        if (p.maxWinners == 0 || p.maxWinners > MAX_WINNERS) revert InvalidWinnerCount();
        if (p.metadata.length > MAX_METADATA_BYTES) revert MetadataTooLarge();

        uint256 received = _pullDeposit(p.token, p.amount);
        uint16 bps = feeBps;
        uint256 fee = _feeOf(received, bps);

        id = keccak256(abi.encode(block.chainid, address(this), ++giveawayCount));

        Giveaway storage g = _giveaways[id];
        g.host = msg.sender;
        g.startTime = p.startTime;
        g.maxWinners = p.maxWinners;
        g.token = p.token;
        g.finalizeDeadline = p.finalizeDeadline;
        g.feeBps = bps;
        g.status = Status.Active;
        g.claimWindow = claimWindow;
        g.prize = received - fee;
        g.fee = fee;
        g.metadataHash = keccak256(p.metadata);

        liabilities[p.token] += received;

        _emitCreated(id, g, p.metadata);
    }

    /// @notice Tops up the prize of an open giveaway before it starts.
    function addFunds(bytes32 id, uint256 amount) external payable whenNotPaused nonReentrant {
        Giveaway storage g = _giveaways[id];
        _requireStatus(g, Status.Active);
        if (msg.sender != g.host) revert NotHost();
        if (block.timestamp >= g.startTime) revert TooLate();

        uint256 received = _pullDeposit(g.token, amount);
        uint256 fee = _feeOf(received, g.feeBps);
        g.prize += received - fee;
        g.fee += fee;
        liabilities[g.token] += received;

        emit FundsAdded(id, msg.sender, received - fee, fee);
    }

    /// @notice Cancels an active giveaway. The host may cancel until the start time and is
    /// refunded in the same transaction. Operators may cancel any active giveaway, for example
    /// one nobody joined, after which the host withdraws the refund.
    function cancel(bytes32 id) external nonReentrant {
        Giveaway storage g = _giveaways[id];
        _requireStatus(g, Status.Active);

        bool isHost = msg.sender == g.host;
        if (!(isHost && block.timestamp < g.startTime) && !hasRole(OPERATOR_ROLE, msg.sender)) {
            if (isHost) revert TooLate();
            revert NotHost();
        }

        g.status = Status.Cancelled;
        emit GiveawayCancelled(id, msg.sender);

        if (isHost) _withdrawToHost(id, g);
    }

    /// @notice Sends the host everything currently owed to them: the full deposit of a cancelled
    /// or expired giveaway, or the undistributed remainder of a finalized one, plus unclaimed
    /// payouts once the claim window has closed. An active giveaway past its finalize deadline
    /// expires on the first call.
    function withdraw(bytes32 id) external nonReentrant {
        Giveaway storage g = _giveaways[id];
        if (msg.sender != g.host) revert NotHost();

        if (g.status == Status.Active && block.timestamp > g.finalizeDeadline) {
            g.status = Status.Expired;
            emit GiveawayExpired(id);
        }

        _withdrawToHost(id, g);
    }

    // Operators and verifiers

    /// @notice Commits to the game seed before the giveaway starts, where
    /// `commitment = keccak256(abi.encode(id, seed))`.
    function commitSeed(bytes32 id, bytes32 commitment)
        external
        whenNotPaused
        onlyRole(OPERATOR_ROLE)
    {
        Giveaway storage g = _giveaways[id];
        _requireStatus(g, Status.Active);
        if (block.timestamp >= g.startTime) revert TooLate();
        if (commitment == bytes32(0)) revert InvalidCommitment();
        if (g.seedCommitment != bytes32(0)) revert SeedAlreadyCommitted();

        g.seedCommitment = commitment;
        emit SeedCommitted(id, commitment);
    }

    /// @notice Records the signed result of a giveaway and opens the claim window. Anyone may
    /// submit it; authority comes from the verifier signatures.
    /// @param signatures Signatures over `settlementDigest(id, s)` from distinct verifiers, sorted
    /// by ascending signer address.
    function finalize(bytes32 id, Settlement calldata s, bytes[] calldata signatures)
        external
        whenNotPaused
    {
        Giveaway storage g = _giveaways[id];
        _requireStatus(g, Status.Active);
        if (block.timestamp < g.startTime) revert TooEarly();
        if (block.timestamp > g.finalizeDeadline) revert TooLate();
        if (g.seedCommitment == bytes32(0)) revert SeedNotCommitted();
        if (keccak256(abi.encode(id, s.seed)) != g.seedCommitment) revert SeedMismatch();
        if (
            s.payoutRoot == bytes32(0) || s.totalPayout == 0 || s.winnerCount == 0
                || s.winnerCount > g.maxWinners
        ) revert InvalidSettlement();
        if (s.totalPayout > g.prize) revert PayoutExceedsPrize();

        _verifySignatures(settlementDigest(id, s), signatures);

        uint64 claimDeadline = uint64(block.timestamp) + g.claimWindow;
        g.status = Status.Finalized;
        g.payoutRoot = s.payoutRoot;
        g.totalPayout = s.totalPayout;
        g.winnerCount = s.winnerCount;
        g.transcriptHash = s.transcriptHash;
        g.claimDeadline = claimDeadline;
        accruedFees[g.token] += g.fee;

        emit GiveawayFinalized(
            id, s.payoutRoot, s.totalPayout, s.winnerCount, s.seed, s.transcriptHash, claimDeadline
        );
    }

    // Winners

    /// @notice Pays out a winner's share. Permissionless so a relayer can claim for winners who
    /// hold no gas; funds always go to `account` or its payout wallet.
    function claim(bytes32 id, address account, uint256 amount, bytes32[] calldata proof)
        external
        nonReentrant
    {
        _claim(id, account, amount, proof);
    }

    function claimMany(ClaimRequest[] calldata requests) external nonReentrant {
        for (uint256 i = 0; i < requests.length; ++i) {
            ClaimRequest calldata r = requests[i];
            _claim(r.id, r.account, r.amount, r.proof);
        }
    }

    /// @notice Redirects funds owed to the caller to another address. Pass zero to clear.
    function setPayoutWallet(address wallet) external {
        if (wallet == address(this)) revert InvalidPayoutWallet();
        payoutWallet[msg.sender] = wallet;
        emit PayoutWalletSet(msg.sender, wallet);
    }

    // Fees and treasury

    /// @notice Sends accrued fees for `token` to the fee recipient. Permissionless because the
    /// destination is fixed.
    function withdrawFees(address token) external nonReentrant {
        uint256 amount = accruedFees[token];
        if (amount == 0) revert NothingToWithdraw();
        accruedFees[token] = 0;
        _payOut(token, feeRecipient, amount);
        emit FeesWithdrawn(token, feeRecipient, amount);
    }

    /// @notice Recovers tokens sent to the contract outside of a deposit. Only the balance above
    /// `liabilities[token]` can be moved.
    function sweep(address token, address to) external nonReentrant onlyRole(DEFAULT_ADMIN_ROLE) {
        if (to == address(0)) revert ZeroAddress();
        uint256 balance =
            token == NATIVE_TOKEN ? address(this).balance : IERC20(token).balanceOf(address(this));
        uint256 owed = liabilities[token];
        if (balance <= owed) revert NothingToWithdraw();
        uint256 excess = balance - owed;
        _send(token, to, excess);
        emit Swept(token, to, excess);
    }

    // Administration

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    /// @notice Applies to giveaways created afterwards; existing ones keep their snapshot.
    function setFeeBps(uint16 newFeeBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setFeeBps(newFeeBps);
    }

    function setFeeRecipient(address newFeeRecipient) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setFeeRecipient(newFeeRecipient);
    }

    /// @notice Applies to giveaways created afterwards; existing ones keep their snapshot.
    function setClaimWindow(uint32 newClaimWindow) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setClaimWindow(newClaimWindow);
    }

    function setVerifierThreshold(uint8 threshold) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setVerifierThreshold(threshold);
    }

    // Views

    function getGiveaway(bytes32 id) external view returns (Giveaway memory) {
        return _giveaways[id];
    }

    /// @notice Amount `withdraw(id)` would send the host now.
    function hostWithdrawable(bytes32 id) external view returns (uint256) {
        Giveaway storage g = _giveaways[id];
        Status status = g.status;
        if (status == Status.Active && block.timestamp > g.finalizeDeadline) {
            status = Status.Expired;
        }
        return _hostEntitlement(g, status) - g.withdrawn;
    }

    function settlementDigest(bytes32 id, Settlement calldata s) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    SETTLEMENT_TYPEHASH,
                    id,
                    s.payoutRoot,
                    s.totalPayout,
                    s.winnerCount,
                    s.seed,
                    s.transcriptHash
                )
            )
        );
    }

    /// @notice Leaf format of the payout tree, matching OpenZeppelin's StandardMerkleTree with
    /// leaf encoding `["bytes32", "address", "uint256"]`.
    function payoutLeaf(bytes32 id, address account, uint256 amount)
        public
        pure
        returns (bytes32)
    {
        return keccak256(bytes.concat(keccak256(abi.encode(id, account, amount))));
    }

    // Internal

    function _claim(bytes32 id, address account, uint256 amount, bytes32[] calldata proof)
        private
    {
        Giveaway storage g = _giveaways[id];
        _requireStatus(g, Status.Finalized);
        if (block.timestamp > g.claimDeadline) revert ClaimWindowClosed();
        if (amount == 0) revert InvalidAmount();
        if (isClaimed[id][account]) revert AlreadyClaimed();
        if (!MerkleProof.verifyCalldata(proof, g.payoutRoot, payoutLeaf(id, account, amount))) {
            revert InvalidProof();
        }

        uint256 claimed = g.claimed + amount;
        // Caps a malformed payout tree at the signed total so it cannot touch other escrows.
        if (claimed > g.totalPayout) revert PayoutExceedsPrize();

        isClaimed[id][account] = true;
        g.claimed = claimed;

        address recipient = _recipientOf(account);
        _payOut(g.token, recipient, amount);
        emit Claimed(id, account, recipient, amount);
    }

    function _withdrawToHost(bytes32 id, Giveaway storage g) private {
        uint256 amount = _hostEntitlement(g, g.status) - g.withdrawn;
        if (amount == 0) revert NothingToWithdraw();

        g.withdrawn += amount;
        address recipient = _recipientOf(g.host);
        _payOut(g.token, recipient, amount);
        emit HostWithdrawal(id, g.host, recipient, amount);
    }

    /// @dev Total the host is entitled to over the giveaway's lifetime. Monotonic in time, so
    /// subtracting `withdrawn` always gives the amount still owed.
    function _hostEntitlement(Giveaway storage g, Status status) private view returns (uint256) {
        if (status == Status.Cancelled || status == Status.Expired) return g.prize + g.fee;
        if (status != Status.Finalized) return 0;

        uint256 entitlement = g.prize - g.totalPayout;
        if (block.timestamp > g.claimDeadline) entitlement += g.totalPayout - g.claimed;
        return entitlement;
    }

    function _verifySignatures(bytes32 digest, bytes[] calldata signatures) private view {
        uint256 threshold = verifierThreshold;
        if (signatures.length < threshold) {
            revert InsufficientSignatures(signatures.length, threshold);
        }

        address previous = address(0);
        for (uint256 i = 0; i < signatures.length; ++i) {
            address signer = ECDSA.recover(digest, signatures[i]);
            if (signer <= previous) revert SignersNotSorted();
            if (!hasRole(VERIFIER_ROLE, signer)) revert UnauthorizedSigner(signer);
            previous = signer;
        }
    }

    /// @dev Split out of createGiveaway to keep its stack shallow.
    function _emitCreated(bytes32 id, Giveaway storage g, bytes calldata metadata) private {
        emit GiveawayCreated(
            id,
            g.host,
            g.token,
            g.prize,
            g.fee,
            g.startTime,
            g.finalizeDeadline,
            g.maxWinners,
            g.claimWindow,
            g.metadataHash,
            metadata
        );
    }

    function _pullDeposit(address token, uint256 amount) private returns (uint256 received) {
        if (amount == 0) revert InvalidAmount();

        if (token == NATIVE_TOKEN) {
            if (msg.value != amount) revert IncorrectNativeValue(amount, msg.value);
            return amount;
        }

        if (msg.value != 0) revert UnexpectedNativeValue();
        if (token.code.length == 0) revert InvalidToken();

        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        received = IERC20(token).balanceOf(address(this)) - balanceBefore;
        if (received == 0) revert InvalidAmount();
    }

    function _payOut(address token, address to, uint256 amount) private {
        liabilities[token] -= amount;
        _send(token, to, amount);
    }

    function _send(address token, address to, uint256 amount) private {
        if (token == NATIVE_TOKEN) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert NativeTransferFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    function _recipientOf(address account) private view returns (address) {
        address wallet = payoutWallet[account];
        return wallet == address(0) ? account : wallet;
    }

    function _requireStatus(Giveaway storage g, Status expected) private view {
        if (g.status != expected) revert InvalidStatus(g.status);
    }

    function _validateSchedule(uint64 startTime, uint64 finalizeDeadline) private view {
        if (
            startTime < block.timestamp + MIN_START_DELAY
                || startTime > block.timestamp + MAX_START_DELAY || finalizeDeadline <= startTime
        ) revert InvalidSchedule();

        uint64 gameWindow = finalizeDeadline - startTime;
        if (gameWindow < MIN_GAME_WINDOW || gameWindow > MAX_GAME_WINDOW) revert InvalidSchedule();
    }

    function _feeOf(uint256 amount, uint16 bps) private pure returns (uint256) {
        return amount * bps / _BPS_DENOMINATOR;
    }

    function _grantAll(bytes32 role, address[] memory accounts) private {
        for (uint256 i = 0; i < accounts.length; ++i) {
            if (accounts[i] == address(0)) revert ZeroAddress();
            _grantRole(role, accounts[i]);
        }
    }

    function _setFeeBps(uint16 newFeeBps) private {
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        feeBps = newFeeBps;
        emit FeeBpsUpdated(newFeeBps);
    }

    function _setFeeRecipient(address newFeeRecipient) private {
        if (newFeeRecipient == address(0)) revert ZeroAddress();
        feeRecipient = newFeeRecipient;
        emit FeeRecipientUpdated(newFeeRecipient);
    }

    function _setClaimWindow(uint32 newClaimWindow) private {
        if (newClaimWindow < MIN_CLAIM_WINDOW || newClaimWindow > MAX_CLAIM_WINDOW) {
            revert InvalidClaimWindow();
        }
        claimWindow = newClaimWindow;
        emit ClaimWindowUpdated(newClaimWindow);
    }

    function _setVerifierThreshold(uint8 threshold) private {
        if (threshold == 0) revert InvalidThreshold();
        verifierThreshold = threshold;
        emit VerifierThresholdUpdated(threshold);
    }
}
