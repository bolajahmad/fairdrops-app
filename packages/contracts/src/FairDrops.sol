// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControlDefaultAdminRules} from
    "@openzeppelin/contracts/access/extensions/AccessControlDefaultAdminRules.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {Nonces} from "@openzeppelin/contracts/utils/Nonces.sol";
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
///
/// Players and hosts never need gas: they sign an action (collect a prize to a wallet, withdraw,
/// set a payout wallet, open a giveaway) and a relayer submits it, keeping a fee in the giveaway's
/// token that the signer agreed to. Relayers may also collect prizes for winners unprompted,
/// keeping a fee capped by `MAX_RELAY_FEE_BPS`.
contract FairDrops is
    IFairDrops,
    AccessControlDefaultAdminRules,
    Pausable,
    ReentrancyGuard,
    EIP712,
    Nonces
{
    using SafeERC20 for IERC20;

    string public constant VERSION = "1";

    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");

    bytes32 public constant SETTLEMENT_TYPEHASH = keccak256(
        "Settlement(bytes32 giveawayId,bytes32 payoutRoot,uint256 totalPayout,uint32 winnerCount,bytes32 seed,bytes32 transcriptHash)"
    );

    bytes32 public constant CLAIM_TO_TYPEHASH = keccak256(
        "ClaimTo(bytes32 giveawayId,address account,uint256 amount,address recipient,uint256 fee,uint256 nonce,uint256 deadline)"
    );
    bytes32 public constant WITHDRAW_TO_TYPEHASH = keccak256(
        "WithdrawTo(bytes32 giveawayId,address host,address recipient,uint256 fee,uint256 nonce,uint256 deadline)"
    );
    bytes32 public constant PAYOUT_WALLET_TYPEHASH =
        keccak256("SetPayoutWallet(address account,address wallet,uint256 nonce,uint256 deadline)");
    bytes32 public constant CREATE_GIVEAWAY_TYPEHASH = keccak256(
        "CreateGiveaway(address host,address token,uint256 amount,uint64 startTime,uint64 finalizeDeadline,uint32 maxWinners,bytes32 metadataHash,uint256 relayFee,uint256 nonce,uint256 deadline)"
    );

    address public constant NATIVE_TOKEN = address(0);
    /// @notice Most a relayer may keep when collecting a prize for a winner unprompted.
    uint16 public constant MAX_RELAY_FEE_BPS = 200;
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
        _grantAll(RELAYER_ROLE, p.relayers);
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
        _validateCreate(p);
        id = _open(msg.sender, p, _pullDeposit(p.token, msg.sender, p.amount));
    }

    /// @notice Opens a giveaway for `host`, who signed its terms and pays no gas. The relayer
    /// keeps `relayFee` out of the deposit; the giveaway's own fee applies to the rest. ERC-20
    /// prizes only: a native prize has to come from the host's own transaction.
    /// @param permit Optional EIP-2612 permit for the deposit, so the host needs no approval
    /// transaction either. Skipped when its deadline is zero, and ignored if it fails, so a
    /// permit someone front-ran doesn't block a giveaway whose allowance already exists.
    function createGiveawayFor(
        CreateParams calldata p,
        address host,
        uint256 relayFee,
        Authorization calldata auth,
        Permit calldata permit
    ) external whenNotPaused nonReentrant returns (bytes32 id) {
        if (p.token == NATIVE_TOKEN) revert InvalidToken();
        _validateCreate(p);
        _authorize(host, _createHash(p, host, relayFee, auth), auth);

        if (permit.deadline != 0) {
            try IERC20Permit(p.token).permit(
                host, address(this), permit.value, permit.deadline, permit.v, permit.r, permit.s
            ) {} catch {}
        }

        uint256 received = _pullDeposit(p.token, host, p.amount);
        if (relayFee >= received) revert FeeTooHigh();
        id = _open(host, p, received - relayFee);
        if (relayFee > 0) {
            IERC20(p.token).safeTransfer(msg.sender, relayFee);
            emit RelayFeePaid(id, host, msg.sender, relayFee);
        }
    }

    /// @notice Tops up the prize of an open giveaway before it starts.
    function addFunds(bytes32 id, uint256 amount) external payable whenNotPaused nonReentrant {
        Giveaway storage g = _giveaways[id];
        _requireStatus(g, Status.Active);
        if (msg.sender != g.host) revert NotHost();
        if (block.timestamp >= g.startTime) revert TooLate();

        uint256 received = _pullDeposit(g.token, msg.sender, amount);
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

        if (isHost) _withdrawToHost(id, g, _recipientOf(g.host), 0);
    }

    /// @notice Sends the host everything currently owed to them: the full deposit of a cancelled
    /// or expired giveaway, or the undistributed remainder of a finalized one, plus unclaimed
    /// payouts once the claim window has closed. An active giveaway past its finalize deadline
    /// expires on the first call.
    function withdraw(bytes32 id) external nonReentrant {
        Giveaway storage g = _giveaways[id];
        if (msg.sender != g.host) revert NotHost();
        _expireIfLate(id, g);
        _withdrawToHost(id, g, _recipientOf(g.host), 0);
    }

    /// @notice `withdraw` for a host who signed it and pays no gas: everything owed goes to
    /// `recipient`, less `fee` for the relayer.
    function withdrawWithSig(
        bytes32 id,
        address recipient,
        uint256 fee,
        Authorization calldata auth
    ) external nonReentrant {
        Giveaway storage g = _giveaways[id];
        address hostAccount = g.host;
        if (hostAccount == address(0)) revert InvalidStatus(g.status);
        _requireRecipient(recipient);
        _authorize(
            hostAccount,
            keccak256(
                abi.encode(
                    WITHDRAW_TO_TYPEHASH, id, hostAccount, recipient, fee, auth.nonce, auth.deadline
                )
            ),
            auth
        );
        _expireIfLate(id, g);
        _withdrawToHost(id, g, recipient, fee);
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
        _claim(id, account, amount, proof, _recipientOf(account), 0);
    }

    function claimMany(ClaimRequest[] calldata requests) external nonReentrant {
        for (uint256 i = 0; i < requests.length; ++i) {
            ClaimRequest calldata r = requests[i];
            _claim(r.id, r.account, r.amount, r.proof, _recipientOf(r.account), 0);
        }
    }

    /// @notice Collects prizes for winners unprompted, so nobody loses a prize to the claim
    /// window. The relayer keeps `fees[i]` for the gas, at most `MAX_RELAY_FEE_BPS` of the prize;
    /// the rest goes to the winner (or their payout wallet).
    function claimManyFor(ClaimRequest[] calldata requests, uint256[] calldata fees)
        external
        nonReentrant
        onlyRole(RELAYER_ROLE)
    {
        if (fees.length != requests.length) revert LengthMismatch();
        for (uint256 i = 0; i < requests.length; ++i) {
            ClaimRequest calldata r = requests[i];
            if (fees[i] > _feeOf(r.amount, MAX_RELAY_FEE_BPS)) revert FeeTooHigh();
            _claim(r.id, r.account, r.amount, r.proof, _recipientOf(r.account), fees[i]);
        }
    }

    /// @notice Collects a prize to `recipient`, for a winner who signed it and pays no gas. The
    /// relayer keeps `fee`, which the winner agreed to in the signature.
    function claimWithSig(
        ClaimRequest calldata r,
        address recipient,
        uint256 fee,
        Authorization calldata auth
    ) external nonReentrant {
        _requireRecipient(recipient);
        _authorize(
            r.account,
            keccak256(
                abi.encode(
                    CLAIM_TO_TYPEHASH,
                    r.id,
                    r.account,
                    r.amount,
                    recipient,
                    fee,
                    auth.nonce,
                    auth.deadline
                )
            ),
            auth
        );
        _claim(r.id, r.account, r.amount, r.proof, recipient, fee);
    }

    /// @notice Redirects funds owed to the caller to another address. Pass zero to clear.
    function setPayoutWallet(address wallet) external {
        _setPayoutWallet(msg.sender, wallet);
    }

    /// @notice `setPayoutWallet` for an account that signed it and pays no gas.
    function setPayoutWalletWithSig(address account, address wallet, Authorization calldata auth)
        external
    {
        _authorize(
            account,
            keccak256(
                abi.encode(PAYOUT_WALLET_TYPEHASH, account, wallet, auth.nonce, auth.deadline)
            ),
            auth
        );
        _setPayoutWallet(account, wallet);
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

    /// @dev Pays `amount` less `fee` to `recipient` and `fee` to the caller (the relayer).
    function _claim(
        bytes32 id,
        address account,
        uint256 amount,
        bytes32[] calldata proof,
        address recipient,
        uint256 fee
    ) private {
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

        if (fee >= amount) revert FeeTooHigh();

        isClaimed[id][account] = true;
        g.claimed = claimed;

        _payOutWithFee(g.token, recipient, amount, fee);
        emit Claimed(id, account, recipient, amount);
        if (fee > 0) emit RelayFeePaid(id, account, msg.sender, fee);
    }

    function _withdrawToHost(bytes32 id, Giveaway storage g, address recipient, uint256 fee)
        private
    {
        uint256 amount = _hostEntitlement(g, g.status) - g.withdrawn;
        if (amount == 0) revert NothingToWithdraw();
        if (fee >= amount) revert FeeTooHigh();

        g.withdrawn += amount;
        _payOutWithFee(g.token, recipient, amount, fee);
        emit HostWithdrawal(id, g.host, recipient, amount);
        if (fee > 0) emit RelayFeePaid(id, g.host, msg.sender, fee);
    }

    function _expireIfLate(bytes32 id, Giveaway storage g) private {
        if (g.status == Status.Active && block.timestamp > g.finalizeDeadline) {
            g.status = Status.Expired;
            emit GiveawayExpired(id);
        }
    }

    function _validateCreate(CreateParams calldata p) private view {
        _validateSchedule(p.startTime, p.finalizeDeadline);
        if (p.maxWinners == 0 || p.maxWinners > MAX_WINNERS) revert InvalidWinnerCount();
        if (p.metadata.length > MAX_METADATA_BYTES) revert MetadataTooLarge();
    }

    /// @dev Records a giveaway whose `deposit` (fee included) is already in the contract.
    function _open(address hostAccount, CreateParams calldata p, uint256 deposit)
        private
        returns (bytes32 id)
    {
        uint16 bps = feeBps;
        uint256 fee = _feeOf(deposit, bps);

        id = keccak256(abi.encode(block.chainid, address(this), ++giveawayCount));

        Giveaway storage g = _giveaways[id];
        g.host = hostAccount;
        g.startTime = p.startTime;
        g.maxWinners = p.maxWinners;
        g.token = p.token;
        g.finalizeDeadline = p.finalizeDeadline;
        g.feeBps = bps;
        g.status = Status.Active;
        g.claimWindow = claimWindow;
        g.prize = deposit - fee;
        g.fee = fee;
        g.metadataHash = keccak256(p.metadata);

        liabilities[p.token] += deposit;

        _emitCreated(id, g, p.metadata);
    }

    function _createHash(
        CreateParams calldata p,
        address hostAccount,
        uint256 relayFee,
        Authorization calldata auth
    ) private pure returns (bytes32) {
        return keccak256(
            abi.encode(
                CREATE_GIVEAWAY_TYPEHASH,
                hostAccount,
                p.token,
                p.amount,
                p.startTime,
                p.finalizeDeadline,
                p.maxWinners,
                keccak256(p.metadata),
                relayFee,
                auth.nonce,
                auth.deadline
            )
        );
    }

    /// @dev Checks a signed authorization and uses up its nonce, so it can't be replayed.
    function _authorize(address account, bytes32 structHash, Authorization calldata auth) private {
        if (block.timestamp > auth.deadline) revert SignatureExpired();
        if (
            !SignatureChecker.isValidSignatureNow(
                account, _hashTypedDataV4(structHash), auth.signature
            )
        ) revert InvalidSignature();
        _useCheckedNonce(account, auth.nonce);
    }

    function _setPayoutWallet(address account, address wallet) private {
        if (wallet == address(this)) revert InvalidPayoutWallet();
        payoutWallet[account] = wallet;
        emit PayoutWalletSet(account, wallet);
    }

    function _requireRecipient(address recipient) private view {
        if (recipient == address(0) || recipient == address(this)) revert InvalidPayoutWallet();
    }

    /// @dev Pays out `amount` owed: `fee` to the relayer submitting the action, the rest to
    /// `recipient`.
    function _payOutWithFee(address token, address recipient, uint256 amount, uint256 fee)
        private
    {
        liabilities[token] -= amount;
        _send(token, recipient, amount - fee);
        if (fee > 0) _send(token, msg.sender, fee);
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

    /// @dev Native deposits come with the call; ERC-20 deposits are pulled from `from`, which
    /// is the caller or a host who signed for a relayer.
    function _pullDeposit(address token, address from, uint256 amount)
        private
        returns (uint256 received)
    {
        if (amount == 0) revert InvalidAmount();

        if (token == NATIVE_TOKEN) {
            if (msg.value != amount) revert IncorrectNativeValue(amount, msg.value);
            return amount;
        }

        if (msg.value != 0) revert UnexpectedNativeValue();
        if (token.code.length == 0) revert InvalidToken();

        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(from, address(this), amount);
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
