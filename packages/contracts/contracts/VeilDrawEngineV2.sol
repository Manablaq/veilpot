// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {FHE, ebool, euint8, euint128, euint256} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/* solhint-disable gas-indexed-events, gas-increment-by-one, function-max-lines */

/// @title VeilDrawEngineV2
/// @notice Non-custodial confidential multi-prize draw engine for Veilpot.
/// @dev
/// - The Engine has no token-transfer, deposit, withdrawal, Autopilot,
///   prize-claim, recipient-selection, or custody authority.
/// - Only the immutable Pool may import ciphertexts or drive draw state.
/// - Pool-owned ciphertexts enter through transaction-scoped ACL.
/// - The Engine persists only fresh Engine-owned derivatives.
/// - No snapshot weight, shard selector, winner selector, candidate, or accepted
///   target is made publicly decryptable.
/// - Only the minimum bucket evidence, aggregate batch-success predicate, and
///   their application-domain proof contexts are publicly decryptable.
contract VeilDrawEngineV2 is ZamaEthereumConfig {
    uint256 public constant MAX_PARTICIPANTS = 128;
    uint256 public constant SHARD_SIZE = 8;
    uint256 public constant SHARD_COUNT = 16;
    uint256 public constant PRIZE_SLOTS = 3;
    uint8 public constant DRAW_BATCH_SIZE = 8;
    uint8 public constant MAX_DRAW_BUCKET_EXPONENT = 69;
    uint128 public constant MAX_DRAW_TOTAL = uint128(1) << MAX_DRAW_BUCKET_EXPONENT;

    /// @dev Keep these ordinals ABI-compatible with the production Pool.
    /// PrizeReserve depends on FINALIZED == 8.
    enum DrawState {
        NO_DRAW,
        BUCKET_DISCOVERY,
        BUCKET_READY,
        AWAITING_CANDIDATE_BATCH,
        BATCH_REDUCTION_PENDING,
        BATCH_PROOF_PENDING,
        CANDIDATE_ACCEPTED,
        WINNER_RESOLUTION,
        FINALIZED,
        NO_WEIGHT_TERMINAL,
        UNSUPPORTED_TOTAL
    }

    address public immutable pool;

    struct Snapshot {
        uint256 participantCount;
        uint256 cursor;
        bool initialized;
        bool isSealed;
        euint128 total;
    }

    struct Draw {
        DrawState state;
        uint256 snapshotId;
        uint8 prizeIndex;
        uint256 participantCount;
        uint256 batchId;
        uint256 bucketAttemptNonce;
        uint8 bucketExponent;
        bool bucketEvidencePrepared;
        euint128 total;
        euint8 encryptedBucketExponent;
        ebool encryptedTotalIsZero;
        ebool encryptedTotalIsSupported;
        euint256 bucketProofContext;
        euint256 batchProofContext;
        euint128[8] candidates;
        ebool[8] candidateValid;
        euint128 batchTarget;
        ebool batchSuccess;
        euint128 acceptedTarget;
    }

    mapping(uint256 => Snapshot) private _snapshots;
    mapping(uint256 => mapping(uint256 => euint128)) private _snapshotWeights;
    mapping(uint256 => mapping(uint256 => euint128)) private _snapshotShardTotals;

    uint256 public nextDrawId;
    uint256 public nextDrawSnapshotId = 1;

    /// @notice Backward-compatible first/slot-zero draw for one snapshot.
    mapping(uint256 => uint256) public snapshotDrawId;

    /// @notice Exact child draw for snapshot + prize index.
    mapping(uint256 => mapping(uint256 => uint256)) public snapshotPrizeDrawId;

    mapping(uint256 => Draw) private _draws;

    error InvalidPool();
    error OnlyPool();
    error InvalidSnapshotId();
    error SnapshotAlreadyInitialized();
    error SnapshotNotInitialized();
    error SnapshotAlreadySealed();
    error SnapshotNotSealed();
    error SnapshotNotComplete();
    error SnapshotCursorMismatch();
    error InvalidParticipantCount();
    error InvalidShardBoundary();
    error MissingPoolGrant();
    error InvalidSlot();
    error InvalidShard();
    error SnapshotNotReadyForDraw();
    error SnapshotAlreadyDrawn();
    error InvalidDraw();
    error DrawSnapshotMismatch();
    error InvalidPrizeIndex();
    error InvalidDrawState(DrawState expected, DrawState actual);
    error DrawEvidenceNotPrepared();
    error DrawEvidenceAlreadyPrepared();
    error DrawBatchMismatch();
    error InvalidDrawBucketEvidence();
    error InvalidDrawIndex();

    event SnapshotImportStarted(uint256 indexed snapshotId, uint256 participantCount);

    event SnapshotChunkImported(
        uint256 indexed snapshotId,
        uint256 indexed shardIndex,
        uint256 start,
        uint256 end
    );

    event SnapshotImportSealed(uint256 indexed snapshotId, uint256 participantCount);

    event DrawRoundStarted(
        uint256 indexed snapshotId,
        uint256 indexed firstDrawId,
        uint256 lastDrawId
    );

    event DrawStarted(
        uint256 indexed drawId,
        uint256 indexed snapshotId,
        uint8 indexed prizeIndex,
        uint256 participantCount
    );

    event DrawBucketResolved(
        uint256 indexed drawId,
        uint256 indexed snapshotId,
        uint8 bucketExponent,
        DrawState state
    );

    event DrawBatchGenerated(
        uint256 indexed drawId,
        uint256 indexed snapshotId,
        uint256 indexed batchId
    );

    event DrawBatchResolved(
        uint256 indexed drawId,
        uint256 indexed snapshotId,
        uint256 indexed batchId,
        bool success
    );

    modifier onlyPool() {
        if (msg.sender != pool) revert OnlyPool();
        _;
    }

    constructor(address pool_) {
        if (pool_ == address(0)) revert InvalidPool();
        pool = pool_;
    }

    // ---------------------------------------------------------------------
    // Immutable encrypted snapshot import
    // ---------------------------------------------------------------------

    function beginSnapshotImport(uint256 snapshotId, uint256 participantCount) external onlyPool {
        if (snapshotId == 0) revert InvalidSnapshotId();

        if (participantCount > MAX_PARTICIPANTS) {
            revert InvalidParticipantCount();
        }

        Snapshot storage snapshot = _snapshots[snapshotId];

        if (snapshot.initialized) {
            revert SnapshotAlreadyInitialized();
        }

        snapshot.participantCount = participantCount;
        snapshot.cursor = 0;
        snapshot.initialized = true;
        snapshot.isSealed = false;
        snapshot.total = FHE.asEuint128(0);

        FHE.allowThis(snapshot.total);

        emit SnapshotImportStarted(snapshotId, participantCount);
    }

    function importSnapshotChunk(
        uint256 snapshotId,
        uint256 start,
        euint128[8] calldata weights
    ) external onlyPool {
        Snapshot storage snapshot = _snapshot(snapshotId);

        if (snapshot.isSealed) {
            revert SnapshotAlreadySealed();
        }

        if (start != snapshot.cursor) {
            revert SnapshotCursorMismatch();
        }

        if (start >= snapshot.participantCount) {
            revert SnapshotNotComplete();
        }

        if (start % SHARD_SIZE != 0) {
            revert InvalidShardBoundary();
        }

        uint256 end = start + SHARD_SIZE;

        if (end > snapshot.participantCount) {
            end = snapshot.participantCount;
        }

        uint256 shardIndex = start / SHARD_SIZE;
        euint128 shardTotal = FHE.asEuint128(0);

        for (uint256 offset = 0; offset < SHARD_SIZE; ++offset) {
            uint256 slotIndex = start + offset;

            if (slotIndex >= snapshot.participantCount) {
                continue;
            }

            euint128 incoming = weights[offset];

            if (!FHE.isAllowed(incoming, address(this))) {
                revert MissingPoolGrant();
            }

            euint128 stored = FHE.add(incoming, FHE.asEuint128(0));

            FHE.allowThis(stored);

            _snapshotWeights[snapshotId][slotIndex] = stored;

            shardTotal = FHE.add(shardTotal, stored);
        }

        FHE.allowThis(shardTotal);

        _snapshotShardTotals[snapshotId][shardIndex] = shardTotal;

        snapshot.total = FHE.add(snapshot.total, shardTotal);

        FHE.allowThis(snapshot.total);

        snapshot.cursor = end;

        emit SnapshotChunkImported(snapshotId, shardIndex, start, end);
    }

    function sealSnapshotImport(uint256 snapshotId) external onlyPool {
        Snapshot storage snapshot = _snapshot(snapshotId);

        if (snapshot.isSealed) {
            revert SnapshotAlreadySealed();
        }

        if (snapshot.cursor != snapshot.participantCount) {
            revert SnapshotNotComplete();
        }

        snapshot.isSealed = true;

        emit SnapshotImportSealed(snapshotId, snapshot.participantCount);
    }

    // ---------------------------------------------------------------------
    // Three-prize round allocation
    // ---------------------------------------------------------------------

    /// @notice Consume exactly the next sealed snapshot and create three
    /// independent child draws atomically.
    /// @dev Child draws share immutable snapshot weights but never RNG state,
    /// batch state, accepted targets, or proof contexts.
    function startDrawRound(
        uint256 snapshotId
    ) external onlyPool returns (uint256[3] memory drawIds) {
        if (snapshotId != nextDrawSnapshotId) {
            revert SnapshotNotReadyForDraw();
        }

        Snapshot storage snapshot = _snapshot(snapshotId);

        if (!snapshot.isSealed) {
            revert SnapshotNotSealed();
        }

        if (snapshotDrawId[snapshotId] != 0) {
            revert SnapshotAlreadyDrawn();
        }

        for (uint256 index = 0; index < PRIZE_SLOTS; ++index) {
            uint256 drawId = ++nextDrawId;

            drawIds[index] = drawId;

            snapshotPrizeDrawId[snapshotId][index] = drawId;

            Draw storage draw = _draws[drawId];

            draw.state = DrawState.BUCKET_DISCOVERY;
            draw.snapshotId = snapshotId;
            draw.prizeIndex = uint8(index);
            draw.participantCount = snapshot.participantCount;
            draw.total = snapshot.total;

            FHE.allowThis(draw.total);

            emit DrawStarted(drawId, snapshotId, uint8(index), snapshot.participantCount);
        }

        snapshotDrawId[snapshotId] = drawIds[0];

        nextDrawSnapshotId = snapshotId + 1;

        emit DrawRoundStarted(snapshotId, drawIds[0], drawIds[2]);
    }

    // ---------------------------------------------------------------------
    // Exact rejection-sampled Zama randomness
    // ---------------------------------------------------------------------

    /// @notice Compute the minimal protected power-of-two rejection bucket.
    /// @dev Only exponent/zero/supported predicates and the application proof
    /// context are made publicly decryptable.
    function prepareDrawBucketEvidence(uint256 drawId, uint256 snapshotId) external onlyPool {
        Draw storage draw = _draw(drawId, snapshotId);

        if (draw.state != DrawState.BUCKET_DISCOVERY) {
            revert InvalidDrawState(DrawState.BUCKET_DISCOVERY, draw.state);
        }

        if (draw.bucketEvidencePrepared) {
            revert DrawEvidenceAlreadyPrepared();
        }

        euint128 threshold = FHE.asEuint128(uint128(1) << 63);

        euint8 exponent = FHE.asEuint8(63);

        uint8[6] memory steps = [uint8(32), 16, 8, 4, 2, 1];

        for (uint256 index = 0; index < steps.length; ++index) {
            uint8 step = steps[index];

            ebool totalAtOrBelow = FHE.le(draw.total, threshold);

            euint128 lowerThreshold = FHE.shr(threshold, step);

            euint128 upperThreshold = FHE.shl(threshold, step);

            threshold = FHE.select(totalAtOrBelow, lowerThreshold, upperThreshold);

            euint8 lowerExponent = FHE.sub(exponent, step);

            euint8 upperExponent = FHE.add(exponent, step);

            exponent = FHE.select(totalAtOrBelow, lowerExponent, upperExponent);
        }

        ebool finalAtOrBelow = FHE.le(draw.total, threshold);

        draw.encryptedBucketExponent = FHE.select(finalAtOrBelow, exponent, FHE.add(exponent, 1));

        draw.encryptedTotalIsZero = FHE.eq(draw.total, 0);

        draw.encryptedTotalIsSupported = FHE.le(draw.total, MAX_DRAW_TOTAL);

        uint256 attemptNonce = ++draw.bucketAttemptNonce;

        draw.bucketProofContext = FHE.asEuint256(
            _drawProofContext(1, drawId, draw, 0, attemptNonce)
        );

        draw.bucketEvidencePrepared = true;

        FHE.allowThis(draw.encryptedBucketExponent);
        FHE.allowThis(draw.encryptedTotalIsZero);
        FHE.allowThis(draw.encryptedTotalIsSupported);
        FHE.allowThis(draw.bucketProofContext);

        FHE.makePubliclyDecryptable(draw.encryptedBucketExponent);
        FHE.makePubliclyDecryptable(draw.encryptedTotalIsZero);
        FHE.makePubliclyDecryptable(draw.encryptedTotalIsSupported);
        FHE.makePubliclyDecryptable(draw.bucketProofContext);
    }

    function submitDrawBucketEvidence(
        uint256 drawId,
        uint256 snapshotId,
        uint8 clearBucketExponent,
        bool clearTotalIsZero,
        bool clearTotalIsSupported,
        bytes calldata decryptionProof
    ) external onlyPool {
        Draw storage draw = _draw(drawId, snapshotId);

        if (draw.state != DrawState.BUCKET_DISCOVERY) {
            revert InvalidDrawState(DrawState.BUCKET_DISCOVERY, draw.state);
        }

        if (!draw.bucketEvidencePrepared) {
            revert DrawEvidenceNotPrepared();
        }

        bytes32[] memory handles = new bytes32[](4);

        handles[0] = FHE.toBytes32(draw.encryptedBucketExponent);

        handles[1] = FHE.toBytes32(draw.encryptedTotalIsZero);

        handles[2] = FHE.toBytes32(draw.encryptedTotalIsSupported);

        handles[3] = FHE.toBytes32(draw.bucketProofContext);

        FHE.checkSignatures(
            handles,
            abi.encode(
                clearBucketExponent,
                clearTotalIsZero,
                clearTotalIsSupported,
                _drawProofContext(1, drawId, draw, 0, draw.bucketAttemptNonce)
            ),
            decryptionProof
        );

        draw.bucketEvidencePrepared = false;

        if (clearTotalIsZero) {
            if (clearBucketExponent != 0 || !clearTotalIsSupported) {
                revert InvalidDrawBucketEvidence();
            }

            draw.state = DrawState.NO_WEIGHT_TERMINAL;

            emit DrawBucketResolved(drawId, snapshotId, 0, draw.state);

            return;
        }

        if (!clearTotalIsSupported) {
            draw.state = DrawState.UNSUPPORTED_TOTAL;

            emit DrawBucketResolved(drawId, snapshotId, clearBucketExponent, draw.state);

            return;
        }

        if (clearBucketExponent > MAX_DRAW_BUCKET_EXPONENT) {
            revert InvalidDrawBucketEvidence();
        }

        draw.bucketExponent = clearBucketExponent;

        draw.state = DrawState.BUCKET_READY;

        emit DrawBucketResolved(drawId, snapshotId, clearBucketExponent, draw.state);
    }

    /// @notice Generate exactly eight fresh protocol-random candidates.
    /// @dev Caller supplies no seed, candidate, threshold, bound, attempt
    /// randomness, or batch size.
    function generateDrawCandidateBatch(uint256 drawId, uint256 snapshotId) external onlyPool {
        Draw storage draw = _draw(drawId, snapshotId);

        bool allowedState =
            draw.state == DrawState.BUCKET_READY ||
                draw.state == DrawState.AWAITING_CANDIDATE_BATCH;

        if (!allowedState) {
            revert InvalidDrawState(DrawState.AWAITING_CANDIDATE_BATCH, draw.state);
        }

        uint128 bound = uint128(1) << draw.bucketExponent;

        uint256 batchId = ++draw.batchId;

        draw.batchProofContext = FHE.asEuint256(
            _drawProofContext(2, drawId, draw, batchId, batchId)
        );

        FHE.allowThis(draw.batchProofContext);

        FHE.makePubliclyDecryptable(draw.batchProofContext);

        for (uint256 index = 0; index < DRAW_BATCH_SIZE; ++index) {
            euint128 candidate = FHE.randEuint128(bound);

            ebool valid = FHE.lt(candidate, draw.total);

            draw.candidates[index] = candidate;

            draw.candidateValid[index] = valid;

            FHE.allowThis(draw.candidates[index]);

            FHE.allowThis(draw.candidateValid[index]);
        }

        draw.state = DrawState.BATCH_REDUCTION_PENDING;

        emit DrawBatchGenerated(drawId, snapshotId, batchId);
    }

    /// @notice Order-preserving balanced reduction selecting the first valid
    /// candidate exactly as production VeilDraw V1.
    function reduceDrawCandidateBatch(
        uint256 drawId,
        uint256 snapshotId,
        uint256 batchId
    ) external onlyPool {
        Draw storage draw = _draw(drawId, snapshotId);

        if (draw.state != DrawState.BATCH_REDUCTION_PENDING) {
            revert InvalidDrawState(DrawState.BATCH_REDUCTION_PENDING, draw.state);
        }

        if (batchId != draw.batchId) {
            revert DrawBatchMismatch();
        }

        euint128[8] memory values;
        ebool[8] memory valid;

        for (uint256 index = 0; index < DRAW_BATCH_SIZE; ++index) {
            values[index] = draw.candidates[index];

            valid[index] = draw.candidateValid[index];
        }

        uint256 width = DRAW_BATCH_SIZE;

        while (width > 1) {
            uint256 nextWidth = width / 2;

            for (uint256 pair = 0; pair < nextWidth; ++pair) {
                uint256 leftIndex = pair * 2;

                uint256 rightIndex = leftIndex + 1;

                values[pair] = FHE.select(valid[leftIndex], values[leftIndex], values[rightIndex]);

                valid[pair] = FHE.or(valid[leftIndex], valid[rightIndex]);
            }

            width = nextWidth;
        }

        draw.batchSuccess = valid[0];

        draw.batchTarget = FHE.select(valid[0], values[0], FHE.asEuint128(0));

        FHE.allowThis(draw.batchSuccess);

        FHE.allowThis(draw.batchTarget);

        FHE.makePubliclyDecryptable(draw.batchSuccess);

        draw.state = DrawState.BATCH_PROOF_PENDING;
    }

    /// @notice A proved failure alone authorizes another fresh PRNG batch.
    function submitDrawBatchEvidence(
        uint256 drawId,
        uint256 snapshotId,
        uint256 batchId,
        bool clearSuccess,
        bytes calldata decryptionProof
    ) external onlyPool {
        Draw storage draw = _draw(drawId, snapshotId);

        if (draw.state != DrawState.BATCH_PROOF_PENDING) {
            revert InvalidDrawState(DrawState.BATCH_PROOF_PENDING, draw.state);
        }

        if (batchId != draw.batchId) {
            revert DrawBatchMismatch();
        }

        bytes32[] memory handles = new bytes32[](2);

        handles[0] = FHE.toBytes32(draw.batchSuccess);

        handles[1] = FHE.toBytes32(draw.batchProofContext);

        FHE.checkSignatures(
            handles,
            abi.encode(clearSuccess, _drawProofContext(2, drawId, draw, batchId, batchId)),
            decryptionProof
        );

        if (clearSuccess) {
            draw.acceptedTarget = draw.batchTarget;

            FHE.allowThis(draw.acceptedTarget);

            draw.state = DrawState.CANDIDATE_ACCEPTED;
        } else {
            draw.state = DrawState.AWAITING_CANDIDATE_BATCH;
        }

        emit DrawBatchResolved(drawId, snapshotId, batchId, clearSuccess);
    }

    // ---------------------------------------------------------------------
    // Review/read surfaces
    // ---------------------------------------------------------------------

    function snapshotMetadata(
        uint256 snapshotId
    )
        external
        view
        returns (uint256 participantCount, uint256 cursor, bool initialized, bool isSealed)
    {
        Snapshot storage snapshot = _snapshots[snapshotId];

        return (
            snapshot.participantCount,
            snapshot.cursor,
            snapshot.initialized,
            snapshot.isSealed
        );
    }

    function snapshotWeightHandle(
        uint256 snapshotId,
        uint256 slotIndex
    ) external view returns (euint128) {
        Snapshot storage snapshot = _snapshot(snapshotId);

        if (slotIndex >= snapshot.participantCount) {
            revert InvalidSlot();
        }

        return _snapshotWeights[snapshotId][slotIndex];
    }

    function snapshotShardTotalHandle(
        uint256 snapshotId,
        uint256 shardIndex
    ) external view returns (euint128) {
        Snapshot storage snapshot = _snapshot(snapshotId);

        uint256 activeShards = (snapshot.participantCount + SHARD_SIZE - 1) / SHARD_SIZE;

        if (shardIndex >= activeShards) {
            revert InvalidShard();
        }

        return _snapshotShardTotals[snapshotId][shardIndex];
    }

    function snapshotTotalHandle(uint256 snapshotId) external view returns (euint128) {
        return _snapshot(snapshotId).total;
    }

    function drawMetadataV2(
        uint256 drawId
    )
        external
        view
        returns (
            DrawState state,
            uint256 snapshotId,
            uint256 participantCount,
            uint256 batchId,
            uint8 bucketExponent,
            uint256 bucketAttemptNonce
        )
    {
        Draw storage draw = _drawExisting(drawId);

        return (
            draw.state,
            draw.snapshotId,
            draw.participantCount,
            draw.batchId,
            draw.bucketExponent,
            draw.bucketAttemptNonce
        );
    }

    function drawPrizeIndex(uint256 drawId) external view returns (uint8) {
        return _drawExisting(drawId).prizeIndex;
    }

    function drawTotalHandle(uint256 drawId) external view returns (euint128) {
        return _drawExisting(drawId).total;
    }

    function drawBucketEvidenceHandles(
        uint256 drawId
    ) external view returns (bytes32, bytes32, bytes32, bytes32) {
        Draw storage draw = _drawExisting(drawId);

        return (
            FHE.toBytes32(draw.encryptedBucketExponent),
            FHE.toBytes32(draw.encryptedTotalIsZero),
            FHE.toBytes32(draw.encryptedTotalIsSupported),
            FHE.toBytes32(draw.bucketProofContext)
        );
    }

    function drawCandidateHandle(uint256 drawId, uint256 index) external view returns (euint128) {
        if (index >= DRAW_BATCH_SIZE) {
            revert InvalidDrawIndex();
        }

        return _drawExisting(drawId).candidates[index];
    }

    function drawBatchHandles(
        uint256 drawId
    ) external view returns (euint128 target, ebool success, bytes32 proofContext) {
        Draw storage draw = _drawExisting(drawId);

        return (draw.batchTarget, draw.batchSuccess, FHE.toBytes32(draw.batchProofContext));
    }

    function drawAcceptedTargetHandle(uint256 drawId) external view returns (euint128) {
        return _drawExisting(drawId).acceptedTarget;
    }

    /// @notice Public proof-domain value for deterministic off-chain review.
    /// @dev This reveals no confidential draw state.
    function drawProofContextValue(
        uint8 stage,
        uint256 drawId,
        uint256 batchId,
        uint256 attemptNonce
    ) external view returns (uint256) {
        Draw storage draw = _drawExisting(drawId);

        return _drawProofContext(stage, drawId, draw, batchId, attemptNonce);
    }

    // ---------------------------------------------------------------------
    // Internal guards / proof binding
    // ---------------------------------------------------------------------

    function _drawProofContext(
        uint8 stage,
        uint256 drawId,
        Draw storage draw,
        uint256 batchId,
        uint256 attemptNonce
    ) internal view returns (uint256) {
        return
            uint256(
                keccak256(
                    abi.encode(
                        bytes32("VEILPOT_DRAW_PROOF_V2"),
                        block.chainid,
                        pool,
                        address(this),
                        draw.snapshotId,
                        drawId,
                        draw.prizeIndex,
                        stage,
                        batchId,
                        attemptNonce
                    )
                )
            );
    }

    function _snapshot(uint256 snapshotId) internal view returns (Snapshot storage snapshot) {
        snapshot = _snapshots[snapshotId];

        if (!snapshot.initialized) {
            revert SnapshotNotInitialized();
        }
    }

    function _draw(uint256 drawId, uint256 snapshotId) internal view returns (Draw storage draw) {
        draw = _drawExisting(drawId);

        if (draw.snapshotId != snapshotId) {
            revert DrawSnapshotMismatch();
        }
    }

    function _drawExisting(uint256 drawId) internal view returns (Draw storage draw) {
        if (drawId == 0 || drawId > nextDrawId) {
            revert InvalidDraw();
        }

        draw = _draws[drawId];

        if (draw.state == DrawState.NO_DRAW) {
            revert InvalidDraw();
        }
    }
}
