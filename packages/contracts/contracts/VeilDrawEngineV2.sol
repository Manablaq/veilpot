// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {FHE, euint128} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/* solhint-disable gas-indexed-events, gas-increment-by-one */

/// @title VeilDrawEngineV2
/// @notice Non-custodial confidential draw engine for Veilpot.
/// @dev
/// - The Engine has no token-transfer, deposit, withdrawal, Autopilot, prize-claim,
///   recipient-selection, or custody authority.
/// - Only the immutable Pool may import ciphertexts or drive draw state.
/// - Pool-owned ciphertexts enter through transaction-scoped ACL.
/// - The Engine persists only fresh Engine-owned derivatives.
/// - No snapshot weight, shard total, shard selector, or winner selector is made
///   publicly decryptable by this contract.
contract VeilDrawEngineV2 is ZamaEthereumConfig {
    uint256 public constant MAX_PARTICIPANTS = 128;
    uint256 public constant SHARD_SIZE = 8;
    uint256 public constant SHARD_COUNT = 16;
    uint256 public constant PRIZE_SLOTS = 3;

    address public immutable pool;

    struct Snapshot {
        uint256 participantCount;
        uint256 cursor;
        bool initialized;
        bool isSealed;
        euint128 total;
    }

    mapping(uint256 => Snapshot) private _snapshots;
    mapping(uint256 => mapping(uint256 => euint128)) private _snapshotWeights;
    mapping(uint256 => mapping(uint256 => euint128)) private _snapshotShardTotals;

    error InvalidPool();
    error OnlyPool();
    error InvalidSnapshotId();
    error SnapshotAlreadyInitialized();
    error SnapshotNotInitialized();
    error SnapshotAlreadySealed();
    error SnapshotNotComplete();
    error SnapshotCursorMismatch();
    error InvalidParticipantCount();
    error InvalidShardBoundary();
    error MissingPoolGrant();
    error InvalidSlot();
    error InvalidShard();

    event SnapshotImportStarted(uint256 indexed snapshotId, uint256 participantCount);

    event SnapshotChunkImported(
        uint256 indexed snapshotId,
        uint256 indexed shardIndex,
        uint256 start,
        uint256 end
    );

    event SnapshotImportSealed(uint256 indexed snapshotId, uint256 participantCount);

    modifier onlyPool() {
        if (msg.sender != pool) revert OnlyPool();
        _;
    }

    constructor(address pool_) {
        if (pool_ == address(0)) revert InvalidPool();
        pool = pool_;
    }

    /// @notice Initialize the Engine-side encrypted copy of one finalized Pool snapshot.
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

    /// @notice Import exactly one logical eight-seat shard.
    /// @dev
    /// The final shard may contain fewer than eight real Pool slots. Padded array
    /// positions are ignored and never affect the encrypted total.
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

            // Persist only a fresh Engine-owned derivative. The Pool grant to
            // `incoming` remains transaction-scoped.
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

    /// @notice Seal the imported encrypted snapshot after every real slot was copied.
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

    function _snapshot(uint256 snapshotId) internal view returns (Snapshot storage snapshot) {
        snapshot = _snapshots[snapshotId];

        if (!snapshot.initialized) {
            revert SnapshotNotInitialized();
        }
    }
}
