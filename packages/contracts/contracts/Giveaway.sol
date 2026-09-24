// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract GiveawayV1 is ReentrancyGuard, Ownable, AccessControl {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    bytes32 public constant VERIFIER_ROLE = keccak256("VERIFIER_ROLE");

    enum Status {
        Null,
        Active,
        Finalized,
        Cancelled
    }

    struct Giveaway {
        address host;
        address token;
        uint256 prize;
        uint64 startTime;
        uint8 winners;
        Status status;
        bytes32 metadata;
    }

    struct Host {
        address owner;
        bytes32 metadataUri;
        uint256 createdAt;
        uint256 updatedAt;
    }

    uint256 public feeBps = 100; // 1% (100 basis points)
    address public feeRecipient;
    mapping(bytes32 => Giveaway) public giveaways;
    mapping(bytes32 => bool) public payouts;
    mapping(address => Host) public hosts;
    mapping(address => address) public preferredPayoutWallet;
    uint256 public nonce;

    event GiveawayCreated(
        bytes32 indexed id,
        address host,
        uint256 amount,
        address token,
        bytes metadata
    );
    event FundsAdded(bytes32 indexed id, uint256 amount);
    event GiveawayCanceled(bytes32 indexed id);
    event ResultCommitted(bytes32 indexed id, bytes32 resultHash);
    event WinnersFinalized(bytes32 indexed id, address[] winners, uint256[] amounts);
    event VerifierUpdated(address verifier, bool allowed);
    event PayoutWalletUpdated(address indexed user, address wallet);
    event HostProfileUpdated(address indexed host, string metadataURI);
    event FeeTaken(bytes32 indexed id, uint256 fee, address recipient);

    modifier onlyHost(bytes32 id) {
        require(giveaways[id].host == msg.sender, "Not host");
        _;
    }
    modifier onlyOpen(bytes32 id) {
        Giveaway storage g = giveaways[id];
        require(
            block.timestamp < g.startTime && g.status == Status.Active,
            "Invalid Window"
        );
        _;
    }

    constructor(address _feeRecipient) Ownable(msg.sender) {
        require(_feeRecipient != address(0), "Zero address");
        feeRecipient = _feeRecipient;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(VERIFIER_ROLE, msg.sender);
    }

    function createGiveaway(
        uint256 amount,
        address token,
        uint64 startTime,
        uint8 winners,
        bytes calldata metadata
    ) external payable nonReentrant {
        require(amount > 0, "Invalid amount");
        require(startTime > block.timestamp, "Invalid start time");
        require(winners > 0, "Invalid winners count");

        uint256 fee = (amount * feeBps) / 10_000;
        uint256 prize = amount - fee;

        if (token == address(0)) {
            require(msg.value == amount, "Incorrect amount");
            payable(feeRecipient).transfer(fee);
        } else {
            IERC20(token).safeTransferFrom(msg.sender, address(this), prize);
            IERC20(token).safeTransferFrom(msg.sender, feeRecipient, fee);
        }

        bytes32 id = keccak256(
            abi.encodePacked(
                msg.sender,
                amount,
                token,
                startTime,
                winners,
                metadata,
                nonce++
            )
        );
        require(
            giveaways[id].host == address(0) &&
                giveaways[id].status == Status.Null,
            "Giveaway already exists"
        );

        giveaways[id] = Giveaway({
            host: msg.sender,
            token: token,
            prize: prize,
            startTime: startTime,
            winners: winners,
            status: Status.Active,
            metadata: keccak256(metadata)
        });
        emit FeeTaken(id, fee, feeRecipient);
        emit GiveawayCreated(id, msg.sender, prize, token, metadata);
    }

    function addFunds(
        bytes32 id,
        uint256 amount
    ) external payable nonReentrant onlyHost(id) onlyOpen(id) {
        Giveaway storage g = giveaways[id];

        if (g.token == address(0)) {
            require(msg.value == amount, "Bad ETH");
        } else {
            IERC20(g.token).safeTransferFrom(msg.sender, address(this), amount);
        }

        g.prize += amount;

        emit FundsAdded(id, amount);
    }

    function cancelGiveaway(
        bytes32 id
    ) external nonReentrant onlyHost(id) onlyOpen(id) {
        Giveaway storage g = giveaways[id];

        g.status = Status.Cancelled;

        uint256 refund = g.prize;
        g.prize = 0;

        _transfer(g.token, msg.sender, refund);

        emit GiveawayCanceled(id);
    }

    function finalizeWinners(
        bytes32 id,
        address[] calldata winners,
        uint256[] calldata amounts,
        bytes calldata signature
    ) external nonReentrant {
        Giveaway storage g = giveaways[id];

        require(
            g.status != Status.Cancelled && g.status != Status.Finalized,
            "Invalid Status"
        );
        require(winners.length == amounts.length, "Mismatch");
        require(winners.length <= g.winners, "Too many");

        bytes32 payoutHash = keccak256(abi.encode(id, winners, amounts));
        require(!payouts[payoutHash], "Already paid");

        // verify signature
        bytes32 ethSigned = payoutHash.toEthSignedMessageHash();
        address signer = ethSigned.recover(signature);
        require(hasRole(VERIFIER_ROLE, signer), "Bad signer");

        uint256 total;
        for (uint256 i = 0; i < winners.length; i++) {
            total += amounts[i];
            _transfer(g.token, winners[i], amounts[i]);
        }
        require(total <= g.prize, "Exceeds prize");
        g.status = Status.Finalized;

        emit WinnersFinalized(id, winners, amounts);
    }

    function updateHostProfile(string calldata metadataURI) external {
        Host storage profile = hosts[msg.sender];

        if (profile.owner == address(0)) {
            profile.owner = msg.sender;
            profile.createdAt = block.timestamp;
        }

        profile.metadataUri = keccak256(abi.encode(metadataURI));
        profile.updatedAt = block.timestamp;

        emit HostProfileUpdated(msg.sender, metadataURI);
    }

    function setPayoutWallet(address wallet) external {
        require(wallet != address(0), "Invalid wallet");

        preferredPayoutWallet[msg.sender] = wallet;

        emit PayoutWalletUpdated(msg.sender, wallet);
    }

    function _transfer(address token, address _to, uint256 amount) internal {
        if (amount == 0) return;
        address to = preferredPayoutWallet[_to] != address(0) ? preferredPayoutWallet[_to] : _to;

        if (token == address(0)) {
            payable(to).transfer(amount);
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }

    function setVerifier(address v, bool allowed) external onlyOwner {
        if (allowed) {
            _grantRole(VERIFIER_ROLE, v);
        } else {
            _revokeRole(VERIFIER_ROLE, v);
        }

        emit VerifierUpdated(v, allowed);
    }

    function setFee(uint256 _feeBps) external onlyOwner {
        require(_feeBps <= 500, "Too high"); // max 5%
        feeBps = _feeBps;
    }

    function setFeeRecipient(address _recipient) external onlyOwner {
        require(_recipient != address(0), "Zero address");
        feeRecipient = _recipient;
    }
}
