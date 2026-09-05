// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {
    FHE,
    ebool,
    euint64,
    euint128,
    euint256,
    externalEuint64
} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";

import {IVeilpotPrizeReserveFunding} from "./interfaces/IVeilpotPrizeReserveFunding.sol";

/* solhint-disable immutable-vars-naming, gas-indexed-events */

/// @title VeilpotSimulatedYieldAdapterV2
/// @author Veilpot
/// @notice Deterministic simulated Sepolia yield adapter for one three-prize Veilpot V2 round.
/// @dev
/// SIMULATED_YIELD_FOR_SEPOLIA_DEMO.
/// One encrypted round yield is recognized exactly once, capped once against
/// dedicated funded liquidity, then partitioned across exactly three child
/// draws with exact encrypted conservation:
/// q=floor(R/3), child0=q, child1=q, child2=R-q-q.
contract VeilpotSimulatedYieldAdapterV2 is ZamaEthereumConfig {
    uint128 public constant BPS_DENOMINATOR = 10_000;
    uint128 public constant DAY_SECONDS = 86_400;
    uint128 public constant YIELD_DENOMINATOR = BPS_DENOMINATOR * DAY_SECONDS;

    uint64 public constant RATE_BPS_PER_DAY = 1;
    uint64 public constant MAX_GROSS_SYNTHETIC_YIELD = 384_000_000_000;

    uint256 public constant PRIZE_COUNT = 3;

    bytes32 public constant YIELD_PROFILE = bytes32("SIMULATED_YIELD_V2_3_PRIZE");

    enum YieldState {
        NONE,
        RECOGNITION_PROOF_PENDING,
        RECOGNIZED,
        SWEEP_PROOF_PENDING,
        FUNDING_FINALIZED
    }

    struct DrawYield {
        YieldState state;
        bool recognized;
        uint256 snapshotId;
        uint8 prizeIndex;
        uint256 sweepAttemptNonce;
        euint64 grossYield;
        euint64 recognizedYield;
        euint64 remainingUnswept;
        ebool statusPredicate;
        euint256 proofContext;
    }

    IERC7984 public immutable confidentialToken;
    address public immutable pool;
    address public immutable reserve;

    mapping(address => uint256) public nextFundingNonce;

    mapping(uint256 => DrawYield) private _drawYields;

    mapping(uint256 => bool) private _roundRecognized;
    mapping(uint256 => uint256[3]) private _roundDrawIds;

    euint64 private _fundedYieldLiquidity;
    euint64 private _committedUnswept;

    uint256 private _entered;

    error InvalidToken();
    error InvalidPool();
    error InvalidReserve();
    error Reentrancy();

    error CallerFunderMismatch();
    error OperatorUnauthorized();
    error FundingNonceMismatch();
    error MissingFundingTransferAcl();

    error OnlyPool();
    error MissingPoolAcl();
    error InvalidRound();
    error InvalidChildDraws();
    error RoundAlreadyRecognized();
    error YieldAlreadyRecognized();

    error UnknownDrawYield();
    error InvalidYieldState(YieldState expected, YieldState actual);

    error MissingSweepTransferAcl();
    error SweepAttemptMismatch();
    error InvalidReserveAcknowledgement();

    event YieldLiquidityFunded(address indexed funder, uint256 indexed fundingNonce);

    event RoundYieldRecognized(uint256 indexed snapshotId, uint256 indexed firstDrawId);

    event DrawYieldRecognized(
        uint256 indexed snapshotId,
        uint256 indexed drawId,
        uint8 indexed prizeIndex
    );

    event DrawYieldRecognitionSettled(uint256 indexed drawId, bool zeroYield);

    event DrawYieldSweepStarted(uint256 indexed drawId, uint256 indexed sweepAttemptNonce);

    event DrawYieldSweepSettled(
        uint256 indexed drawId,
        uint256 indexed sweepAttemptNonce,
        bool complete
    );

    modifier nonReentrant() {
        if (_entered != 0) revert Reentrancy();

        _entered = 1;
        _;
        _entered = 0;
    }

    modifier onlyPool() {
        if (msg.sender != pool) revert OnlyPool();

        _;
    }

    constructor(IERC7984 token_, address pool_, address reserve_) {
        if (address(token_) == address(0)) revert InvalidToken();
        if (pool_ == address(0)) revert InvalidPool();
        if (reserve_ == address(0)) revert InvalidReserve();

        confidentialToken = token_;
        pool = pool_;
        reserve = reserve_;

        _fundedYieldLiquidity = FHE.asEuint64(0);
        _committedUnswept = FHE.asEuint64(0);

        FHE.allowThis(_fundedYieldLiquidity);
        FHE.allowThis(_committedUnswept);
    }

    /// @notice Pull explicitly dedicated non-principal simulated-yield liquidity.
    /// @dev Accounting uses only the ERC-7984 returned actual transfer.
    function fundYieldLiquidity(
        externalEuint64 encryptedAmount,
        bytes calldata inputProof,
        address funder,
        uint256 fundingNonce
    ) external nonReentrant {
        if (msg.sender != funder) revert CallerFunderMismatch();

        if (fundingNonce != nextFundingNonce[funder]) {
            revert FundingNonceMismatch();
        }

        if (!confidentialToken.isOperator(funder, address(this))) {
            revert OperatorUnauthorized();
        }

        euint64 requested = FHE.fromExternal(encryptedAmount, inputProof);

        FHE.allowTransient(requested, address(confidentialToken));

        euint64 actualTransferred = confidentialToken.confidentialTransferFrom(
            funder,
            address(this),
            requested
        );

        if (!FHE.isAllowed(actualTransferred, address(this))) {
            revert MissingFundingTransferAcl();
        }

        _fundedYieldLiquidity = FHE.add(_fundedYieldLiquidity, actualTransferred);

        FHE.allowThis(_fundedYieldLiquidity);

        nextFundingNonce[funder] = fundingNonce + 1;

        emit YieldLiquidityFunded(funder, fundingNonce);
    }

    /// @notice Recognize and partition one immutable round exactly once.
    /// @param snapshotId Pool snapshot backing the three child draws.
    /// @param drawIds Exact three consecutive child draw IDs for that snapshot.
    /// @param rawTotalTwab Encrypted immutable snapshot total granted transiently by Pool.
    function recognizeRoundYield(
        uint256 snapshotId,
        uint256[3] calldata drawIds,
        euint128 rawTotalTwab
    ) external onlyPool nonReentrant {
        if (snapshotId == 0) revert InvalidRound();

        if (_roundRecognized[snapshotId]) {
            revert RoundAlreadyRecognized();
        }

        if (drawIds[0] == 0 || drawIds[1] != drawIds[0] + 1 || drawIds[2] != drawIds[1] + 1) {
            revert InvalidChildDraws();
        }

        for (uint256 index = 0; index < PRIZE_COUNT; ++index) {
            if (_drawYields[drawIds[index]].recognized) {
                revert YieldAlreadyRecognized();
            }
        }

        if (!FHE.isAllowed(rawTotalTwab, address(this))) {
            revert MissingPoolAcl();
        }

        euint128 gross128 = FHE.div(rawTotalTwab, YIELD_DENOMINATOR);

        euint128 boundedGross128 = FHE.min(gross128, uint128(MAX_GROSS_SYNTHETIC_YIELD));

        euint64 grossRound = FHE.asEuint64(boundedGross128);

        // Cap the round exactly once before any child split.
        euint64 recognizedRound = FHE.min(grossRound, _fundedYieldLiquidity);

        _fundedYieldLiquidity = FHE.sub(_fundedYieldLiquidity, recognizedRound);

        _committedUnswept = FHE.add(_committedUnswept, recognizedRound);

        FHE.allowThis(_fundedYieldLiquidity);
        FHE.allowThis(_committedUnswept);

        euint64[3] memory grossParts = _splitThree(grossRound);

        euint64[3] memory recognizedParts = _splitThree(recognizedRound);

        _roundRecognized[snapshotId] = true;

        _roundDrawIds[snapshotId][0] = drawIds[0];
        _roundDrawIds[snapshotId][1] = drawIds[1];
        _roundDrawIds[snapshotId][2] = drawIds[2];

        for (uint256 index = 0; index < PRIZE_COUNT; ++index) {
            uint256 drawId = drawIds[index];

            DrawYield storage draw = _drawYields[drawId];

            draw.state = YieldState.RECOGNITION_PROOF_PENDING;

            draw.recognized = true;
            draw.snapshotId = snapshotId;
            draw.prizeIndex = uint8(index);

            draw.grossYield = grossParts[index];

            draw.recognizedYield = recognizedParts[index];

            draw.remainingUnswept = recognizedParts[index];

            draw.statusPredicate = FHE.eq(recognizedParts[index], FHE.asEuint64(0));

            draw.proofContext = FHE.asEuint256(
                _proofContext(snapshotId, drawId, uint8(index), 1, 0)
            );

            FHE.allowThis(draw.grossYield);
            FHE.allowThis(draw.recognizedYield);
            FHE.allowThis(draw.remainingUnswept);
            FHE.allowThis(draw.statusPredicate);
            FHE.allowThis(draw.proofContext);

            // Only zero/non-zero and exact proof context are public.
            FHE.makePubliclyDecryptable(draw.statusPredicate);

            FHE.makePubliclyDecryptable(draw.proofContext);

            emit DrawYieldRecognized(snapshotId, drawId, uint8(index));
        }

        emit RoundYieldRecognized(snapshotId, drawIds[0]);
    }

    function settleRecognition(
        uint256 drawId,
        bool clearZeroYield,
        bytes calldata decryptionProof
    ) external nonReentrant {
        DrawYield storage draw = _drawYield(drawId);

        if (draw.state != YieldState.RECOGNITION_PROOF_PENDING) {
            revert InvalidYieldState(YieldState.RECOGNITION_PROOF_PENDING, draw.state);
        }

        bytes32[] memory handles = new bytes32[](2);

        handles[0] = FHE.toBytes32(draw.statusPredicate);

        handles[1] = FHE.toBytes32(draw.proofContext);

        FHE.checkSignatures(
            handles,
            abi.encode(
                clearZeroYield,
                _proofContext(draw.snapshotId, drawId, draw.prizeIndex, 1, 0)
            ),
            decryptionProof
        );

        draw.state = clearZeroYield ? YieldState.FUNDING_FINALIZED : YieldState.RECOGNIZED;

        emit DrawYieldRecognitionSettled(drawId, clearZeroYield);
    }

    /// @notice Attempt one fixed-recipient sweep of a child residual.
    /// @dev Accounting uses only the token-returned actual transfer.
    function sweepYield(uint256 drawId) external nonReentrant {
        DrawYield storage draw = _drawYield(drawId);

        if (draw.state != YieldState.RECOGNIZED) {
            revert InvalidYieldState(YieldState.RECOGNIZED, draw.state);
        }

        uint256 attemptNonce = ++draw.sweepAttemptNonce;

        euint64 requested = draw.remainingUnswept;

        FHE.allowThis(requested);

        FHE.allowTransient(requested, address(confidentialToken));

        euint64 actualTransferred = confidentialToken.confidentialTransfer(reserve, requested);

        if (!FHE.isAllowed(actualTransferred, address(this))) {
            revert MissingSweepTransferAcl();
        }

        draw.remainingUnswept = FHE.sub(draw.remainingUnswept, actualTransferred);

        _committedUnswept = FHE.sub(_committedUnswept, actualTransferred);

        FHE.allowThis(draw.remainingUnswept);
        FHE.allowThis(_committedUnswept);

        FHE.allowTransient(actualTransferred, reserve);

        bytes4 acknowledgement = IVeilpotPrizeReserveFunding(reserve).recordYield(
            drawId,
            actualTransferred
        );

        if (acknowledgement != IVeilpotPrizeReserveFunding.recordYield.selector) {
            revert InvalidReserveAcknowledgement();
        }

        draw.statusPredicate = FHE.eq(draw.remainingUnswept, FHE.asEuint64(0));

        draw.proofContext = FHE.asEuint256(
            _proofContext(draw.snapshotId, drawId, draw.prizeIndex, 2, attemptNonce)
        );

        draw.state = YieldState.SWEEP_PROOF_PENDING;

        FHE.allowThis(draw.statusPredicate);
        FHE.allowThis(draw.proofContext);

        FHE.makePubliclyDecryptable(draw.statusPredicate);

        FHE.makePubliclyDecryptable(draw.proofContext);

        emit DrawYieldSweepStarted(drawId, attemptNonce);
    }

    function settleSweepCompletion(
        uint256 drawId,
        uint256 sweepAttemptNonce,
        bool clearComplete,
        bytes calldata decryptionProof
    ) external nonReentrant {
        DrawYield storage draw = _drawYield(drawId);

        if (draw.state != YieldState.SWEEP_PROOF_PENDING) {
            revert InvalidYieldState(YieldState.SWEEP_PROOF_PENDING, draw.state);
        }

        if (sweepAttemptNonce != draw.sweepAttemptNonce) {
            revert SweepAttemptMismatch();
        }

        bytes32[] memory handles = new bytes32[](2);

        handles[0] = FHE.toBytes32(draw.statusPredicate);

        handles[1] = FHE.toBytes32(draw.proofContext);

        FHE.checkSignatures(
            handles,
            abi.encode(
                clearComplete,
                _proofContext(draw.snapshotId, drawId, draw.prizeIndex, 2, sweepAttemptNonce)
            ),
            decryptionProof
        );

        draw.state = clearComplete ? YieldState.FUNDING_FINALIZED : YieldState.RECOGNIZED;

        emit DrawYieldSweepSettled(drawId, sweepAttemptNonce, clearComplete);
    }

    function liquidityHandles()
        external
        view
        returns (euint64 fundedYieldLiquidity, euint64 committedUnswept)
    {
        return (_fundedYieldLiquidity, _committedUnswept);
    }

    /// @notice Preserve the Reserve-facing V1 tuple layout.
    /// @dev The first returned ABI word remains the YieldState ordinal.
    function drawYieldHandles(
        uint256 drawId
    )
        external
        view
        returns (
            YieldState state,
            euint64 grossYield,
            euint64 recognizedYield,
            euint64 remainingUnswept,
            ebool statusPredicate,
            bytes32 proofContext,
            uint256 sweepAttemptNonce
        )
    {
        DrawYield storage draw = _drawYield(drawId);

        return (
            draw.state,
            draw.grossYield,
            draw.recognizedYield,
            draw.remainingUnswept,
            draw.statusPredicate,
            FHE.toBytes32(draw.proofContext),
            draw.sweepAttemptNonce
        );
    }

    function drawRoundMetadata(
        uint256 drawId
    ) external view returns (uint256 snapshotId, uint8 prizeIndex) {
        DrawYield storage draw = _drawYield(drawId);

        return (draw.snapshotId, draw.prizeIndex);
    }

    function roundDrawIds(uint256 snapshotId) external view returns (uint256[3] memory drawIds) {
        if (!_roundRecognized[snapshotId]) {
            revert InvalidRound();
        }

        return _roundDrawIds[snapshotId];
    }

    function roundRecognized(uint256 snapshotId) external view returns (bool) {
        return _roundRecognized[snapshotId];
    }

    /// @dev Create distinct child ciphertext handles while conserving amount exactly.
    function _splitThree(euint64 amount) internal returns (euint64[3] memory parts) {
        euint64 quotient = FHE.div(amount, uint64(3));

        // Fresh derivatives avoid exposing handle identity between equal children.
        parts[0] = FHE.add(quotient, FHE.asEuint64(0));

        parts[1] = FHE.add(quotient, FHE.asEuint64(0));

        parts[2] = FHE.sub(FHE.sub(amount, quotient), quotient);
    }

    function _drawYield(uint256 drawId) internal view returns (DrawYield storage draw) {
        draw = _drawYields[drawId];

        if (!draw.recognized) {
            revert UnknownDrawYield();
        }
    }

    function _proofContext(
        uint256 snapshotId,
        uint256 drawId,
        uint8 prizeIndex,
        uint8 stage,
        uint256 attemptNonce
    ) internal view returns (uint256) {
        return
            uint256(
                keccak256(
                    abi.encode(
                        bytes32("VEILPOT_YIELD_PROOF_V2"),
                        block.chainid,
                        address(this),
                        pool,
                        reserve,
                        snapshotId,
                        drawId,
                        prizeIndex,
                        stage,
                        attemptNonce
                    )
                )
            );
    }
}
