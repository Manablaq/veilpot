// SPDX-License-Identifier: BSD-3-Clause-Clear
pragma solidity 0.8.27;

import {FHE, ebool, euint8, euint128, externalEuint128} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @title VeilDraw Gate 0 FHEVM probe
/// @author Veilpot
/// @notice Measurement-only implementation; deliberately not a production pool contract.
contract VeilDrawProbe is ZamaEthereumConfig {
    /// @notice Largest supported candidate batch.
    uint8 public constant MAX_BATCH_SIZE = 16;
    /// @notice Largest bucket exponent allowed by the probe application envelope.
    uint8 public constant MAX_BUCKET_EXPONENT = 120;
    /// @notice Largest encrypted total allowed by the probe application envelope.
    uint128 public constant MAX_TOTAL = uint128(1) << MAX_BUCKET_EXPONENT;

    enum DrawState {
        AwaitingBucket,
        BucketReady,
        AwaitingCandidateBatch,
        AwaitingBatchProof,
        CandidateAccepted,
        NoEligibleWeight,
        UnsupportedTotal
    }

    error AlreadyStarted();
    error InvalidState(DrawState expected, DrawState actual);
    error InvalidBatchSize(uint8 size);
    error EvidenceNotPrepared();
    error ReductionAlreadyRun();
    error ReductionMissing();
    error InvalidBucketEvidence();
    error InvalidPrefixInput();

    /// @notice Current immutable draw state.
    DrawState public state = DrawState.AwaitingBucket;
    /// @notice Whether the one-draw probe has received its encrypted total.
    bool public drawStarted;
    /// @notice Fixed identifier for this single-draw probe instance.
    uint256 public constant DRAW_ID = 1;
    /// @notice Monotonic candidate batch identifier.
    uint256 public batchId;
    /// @notice Public, proven exponent defining the current power-of-two bucket.
    uint8 public bucketExponent;
    /// @notice Number of candidates in the current batch.
    uint8 public batchSize;

    euint128 private _total;
    euint8 private _encryptedBucketExponent;
    ebool private _encryptedTotalIsZero;
    ebool private _encryptedTotalIsSupported;

    euint128[16] private _candidates;
    ebool[16] private _candidateValid;
    euint128 private _serialValue;
    ebool private _serialValid;
    euint128 private _balancedValue;
    ebool private _balancedValid;
    euint128 private _acceptedTarget;
    /// @notice Whether serial reduction has been computed for the current batch.
    bool public serialReduced;
    /// @notice Whether ordered balanced reduction has been computed for the current batch.
    bool public balancedReduced;
    /// @notice Whether the current serial success predicate is publicly decryptable.
    bool public batchEvidencePrepared;

    euint128 private _lastPrefix;
    euint128 private _lastWinnerCount;
    ebool[16] private _lastWinnerPredicates;
    /// @notice Participant count used by the most recent isolated prefix benchmark.
    uint8 public lastPrefixParticipantCount;

    /// @notice Stores the encrypted aggregate total for the one-draw probe.
    /// @param encryptedTotal Input-verifier bound external encrypted total.
    /// @param inputProof Input-verifier proof for `encryptedTotal`.
    function startDraw(externalEuint128 encryptedTotal, bytes calldata inputProof) external {
        if (drawStarted) revert AlreadyStarted();
        drawStarted = true;
        _total = FHE.fromExternal(encryptedTotal, inputProof);
        FHE.allowThis(_total);
    }

    /// @notice Computes ceil(log2(T)) by a fixed seven-comparison encrypted binary search.
    function prepareBucketEvidence() external {
        if (!drawStarted) revert EvidenceNotPrepared();
        if (state != DrawState.AwaitingBucket) {
            revert InvalidState(DrawState.AwaitingBucket, state);
        }

        euint128 threshold = FHE.asEuint128(uint128(1) << 63);
        euint8 exponent = FHE.asEuint8(63);
        uint8[6] memory steps = [uint8(32), 16, 8, 4, 2, 1];

        for (uint256 index = 0; index < steps.length; ++index) {
            uint8 step = steps[index];
            ebool totalAtOrBelow = FHE.le(_total, threshold);
            euint128 lowerThreshold = FHE.shr(threshold, step);
            euint128 upperThreshold = FHE.shl(threshold, step);
            threshold = FHE.select(totalAtOrBelow, lowerThreshold, upperThreshold);

            euint8 lowerExponent = FHE.sub(exponent, step);
            euint8 upperExponent = FHE.add(exponent, step);
            exponent = FHE.select(totalAtOrBelow, lowerExponent, upperExponent);
        }

        ebool finalAtOrBelow = FHE.le(_total, threshold);
        _encryptedBucketExponent = FHE.select(finalAtOrBelow, exponent, FHE.add(exponent, 1));
        _encryptedTotalIsZero = FHE.eq(_total, 0);
        _encryptedTotalIsSupported = FHE.le(_total, MAX_TOTAL);

        FHE.allowThis(_encryptedBucketExponent);
        FHE.allowThis(_encryptedTotalIsZero);
        FHE.allowThis(_encryptedTotalIsSupported);
        FHE.makePubliclyDecryptable(_encryptedBucketExponent);
        FHE.makePubliclyDecryptable(_encryptedTotalIsZero);
        FHE.makePubliclyDecryptable(_encryptedTotalIsSupported);
    }

    /// @notice Verifies controlled public bucket evidence and selects the next terminal or ready state.
    /// @param clearBucketExponent KMS-decrypted minimal bucket exponent.
    /// @param clearTotalIsZero KMS-decrypted fixed zero predicate.
    /// @param clearTotalIsSupported KMS-decrypted fixed support-domain predicate.
    /// @param decryptionProof KMS proof bound to the ordered bucket evidence handles.
    function submitBucketEvidence(
        uint8 clearBucketExponent,
        bool clearTotalIsZero,
        bool clearTotalIsSupported,
        bytes calldata decryptionProof
    ) external {
        if (state != DrawState.AwaitingBucket) {
            revert InvalidState(DrawState.AwaitingBucket, state);
        }
        if (FHE.toBytes32(_encryptedBucketExponent) == bytes32(0)) revert EvidenceNotPrepared();

        bytes32[] memory handles = new bytes32[](3);
        handles[0] = FHE.toBytes32(_encryptedBucketExponent);
        handles[1] = FHE.toBytes32(_encryptedTotalIsZero);
        handles[2] = FHE.toBytes32(_encryptedTotalIsSupported);
        FHE.checkSignatures(
            handles,
            abi.encode(clearBucketExponent, clearTotalIsZero, clearTotalIsSupported),
            decryptionProof
        );

        if (clearTotalIsZero) {
            if (clearBucketExponent != 0 || !clearTotalIsSupported) revert InvalidBucketEvidence();
            state = DrawState.NoEligibleWeight;
            return;
        }
        if (!clearTotalIsSupported) {
            state = DrawState.UnsupportedTotal;
            return;
        }
        if (clearBucketExponent > MAX_BUCKET_EXPONENT) revert InvalidBucketEvidence();
        bucketExponent = clearBucketExponent;
        state = DrawState.BucketReady;
    }

    /// @notice Generates a fresh, internally bounded encrypted candidate batch.
    /// @param size One of 1, 2, 4, 8, or 16.
    function generateCandidateBatch(uint8 size) external {
        bool allowedState =
            state == DrawState.BucketReady || state == DrawState.AwaitingCandidateBatch;
        if (!allowedState) revert InvalidState(DrawState.AwaitingCandidateBatch, state);
        if (!_isAllowedBatchSize(size)) revert InvalidBatchSize(size);

        ++batchId;
        batchSize = size;
        serialReduced = false;
        balancedReduced = false;
        batchEvidencePrepared = false;
        uint128 bound = uint128(1) << bucketExponent;

        for (uint256 index = 0; index < size; ++index) {
            euint128 candidate = FHE.randEuint128(bound);
            ebool valid = FHE.lt(candidate, _total);
            _candidates[index] = candidate;
            _candidateValid[index] = valid;
            FHE.allowThis(candidate);
            FHE.allowThis(valid);
        }
        state = DrawState.AwaitingBatchProof;
    }

    /// @notice Computes earliest-valid selection by the serial reference reduction.
    function reduceSerial() external {
        _requireBatchReductionState();
        if (serialReduced) revert ReductionAlreadyRun();

        ebool chosenValid = FHE.asEbool(false);
        euint128 chosenValue = FHE.asEuint128(0);
        for (uint256 index = 0; index < batchSize; ++index) {
            ebool take = FHE.and(FHE.not(chosenValid), _candidateValid[index]);
            chosenValue = FHE.select(take, _candidates[index], chosenValue);
            chosenValid = FHE.or(chosenValid, _candidateValid[index]);
        }
        _serialValue = chosenValue;
        _serialValid = chosenValid;
        serialReduced = true;
        FHE.allowThis(_serialValue);
        FHE.allowThis(_serialValid);
    }

    /// @notice Computes earliest-valid selection by an order-preserving balanced tree.
    function reduceBalanced() external {
        _requireBatchReductionState();
        if (balancedReduced) revert ReductionAlreadyRun();

        euint128[16] memory values;
        ebool[16] memory valid;
        for (uint256 index = 0; index < batchSize; ++index) {
            values[index] = _candidates[index];
            valid[index] = _candidateValid[index];
        }

        uint256 width = batchSize;
        while (width > 1) {
            uint256 nextWidth = (width + 1) / 2;
            for (uint256 pair = 0; pair < nextWidth; ++pair) {
                uint256 leftIndex = pair * 2;
                uint256 rightIndex = leftIndex + 1;
                if (rightIndex < width) {
                    values[pair] = FHE.select(
                        valid[leftIndex],
                        values[leftIndex],
                        values[rightIndex]
                    );
                    valid[pair] = FHE.or(valid[leftIndex], valid[rightIndex]);
                } else {
                    values[pair] = values[leftIndex];
                    valid[pair] = valid[leftIndex];
                }
            }
            width = nextWidth;
        }

        _balancedValid = valid[0];
        _balancedValue = FHE.select(valid[0], values[0], FHE.asEuint128(0));
        balancedReduced = true;
        FHE.allowThis(_balancedValue);
        FHE.allowThis(_balancedValid);
    }

    /// @notice Marks only the aggregate serial success predicate publicly decryptable.
    function prepareBatchEvidence() external {
        _requireBatchReductionState();
        if (!serialReduced || !balancedReduced) revert ReductionMissing();
        if (batchEvidencePrepared) revert ReductionAlreadyRun();
        batchEvidencePrepared = true;
        FHE.makePubliclyDecryptable(_serialValid);
    }

    /// @notice Verifies batch success and either accepts the target or enables a fresh batch.
    /// @param clearSuccess KMS-decrypted aggregate batch success predicate.
    /// @param decryptionProof KMS proof bound to the current batch success handle.
    function submitBatchEvidence(bool clearSuccess, bytes calldata decryptionProof) external {
        _requireBatchReductionState();
        if (!batchEvidencePrepared) revert EvidenceNotPrepared();

        bytes32[] memory handles = new bytes32[](1);
        handles[0] = FHE.toBytes32(_serialValid);
        FHE.checkSignatures(handles, abi.encode(clearSuccess), decryptionProof);

        batchEvidencePrepared = false;
        if (clearSuccess) {
            _acceptedTarget = _serialValue;
            FHE.allowThis(_acceptedTarget);
            state = DrawState.CandidateAccepted;
        } else {
            state = DrawState.AwaitingCandidateBatch;
        }
    }

    /// @notice Isolated settlement-cost probe; it cannot mutate the draw or provide draw randomness.
    /// @param encryptedWeights Input-verifier bound encrypted participant weights.
    /// @param weightsInputProof Input-verifier proof for `encryptedWeights`.
    /// @param encryptedTarget Input-verifier bound encrypted target.
    /// @param targetInputProof Input-verifier proof for `encryptedTarget`.
    function benchmarkPrefixSelection(
        externalEuint128[] calldata encryptedWeights,
        bytes calldata weightsInputProof,
        externalEuint128 encryptedTarget,
        bytes calldata targetInputProof
    ) external {
        uint256 count = encryptedWeights.length;
        if (count == 0 || count > MAX_BATCH_SIZE) revert InvalidPrefixInput();

        euint128 target = FHE.fromExternal(encryptedTarget, targetInputProof);
        euint128 prefix = FHE.asEuint128(0);
        euint128 winnerCount = FHE.asEuint128(0);
        for (uint256 index = 0; index < count; ++index) {
            euint128 weight = FHE.fromExternal(encryptedWeights[index], weightsInputProof);
            euint128 afterPrefix = FHE.add(prefix, weight);
            ebool winner = FHE.and(FHE.le(prefix, target), FHE.lt(target, afterPrefix));
            _lastWinnerPredicates[index] = winner;
            winnerCount = FHE.add(winnerCount, FHE.asEuint128(winner));
            prefix = afterPrefix;
            FHE.allowThis(winner);
        }
        _lastPrefix = prefix;
        _lastWinnerCount = winnerCount;
        lastPrefixParticipantCount = uint8(count);
        FHE.allowThis(_lastPrefix);
        FHE.allowThis(_lastWinnerCount);
    }

    /// @notice Returns handles for the only bucket evidence values intentionally made public.
    function bucketEvidenceHandles() external view returns (bytes32, bytes32, bytes32) {
        return (
            FHE.toBytes32(_encryptedBucketExponent),
            FHE.toBytes32(_encryptedTotalIsZero),
            FHE.toBytes32(_encryptedTotalIsSupported)
        );
    }

    /// @notice Returns the protected encrypted total handle; it grants no decryption right.
    function totalHandle() external view returns (bytes32) {
        return FHE.toBytes32(_total);
    }

    /// @notice Returns a protected candidate handle for test-only inspection.
    /// @param index Candidate index below the fixed storage capacity.
    function candidateHandle(uint256 index) external view returns (bytes32) {
        return FHE.toBytes32(_candidates[index]);
    }

    /// @notice Returns a protected individual-validity handle for test-only inspection.
    /// @param index Candidate index below the fixed storage capacity.
    function candidateValidHandle(uint256 index) external view returns (bytes32) {
        return FHE.toBytes32(_candidateValid[index]);
    }

    /// @notice Returns protected serial and balanced reduction handles for test-only comparison.
    function reductionHandles() external view returns (bytes32, bytes32, bytes32, bytes32) {
        return (
            FHE.toBytes32(_serialValue),
            FHE.toBytes32(_serialValid),
            FHE.toBytes32(_balancedValue),
            FHE.toBytes32(_balancedValid)
        );
    }

    /// @notice Returns the protected accepted target handle.
    function acceptedTargetHandle() external view returns (bytes32) {
        return FHE.toBytes32(_acceptedTarget);
    }

    /// @notice Returns protected final prefix and winner-count handles from the isolated benchmark.
    function prefixHandles() external view returns (bytes32, bytes32) {
        return (FHE.toBytes32(_lastPrefix), FHE.toBytes32(_lastWinnerCount));
    }

    /// @notice Returns a protected benchmark winner predicate handle.
    /// @param index Participant index below the fixed storage capacity.
    function winnerPredicateHandle(uint256 index) external view returns (bytes32) {
        return FHE.toBytes32(_lastWinnerPredicates[index]);
    }

    function _requireBatchReductionState() private view {
        if (state != DrawState.AwaitingBatchProof) {
            revert InvalidState(DrawState.AwaitingBatchProof, state);
        }
    }

    function _isAllowedBatchSize(uint8 size) private pure returns (bool) {
        return size == 1 || size == 2 || size == 4 || size == 8 || size == 16;
    }
}
