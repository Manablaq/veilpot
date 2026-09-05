// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {FHE, euint64, euint128, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

import {VeilDrawEngineV2} from "./VeilDrawEngineV2.sol";

/* solhint-disable gas-increment-by-one */

/// @notice Test-only Pool-side host for VeilDrawEngineV2.
contract TestVeilDrawEngineV2Host is ZamaEthereumConfig {
    VeilDrawEngineV2 public immutable engine;

    euint128[128] private _weights;

    error InvalidSlot();

    constructor() {
        engine = new VeilDrawEngineV2(address(this));
    }

    function setWeight(
        uint256 slotIndex,
        externalEuint64 encryptedWeight,
        bytes calldata inputProof
    ) external {
        if (slotIndex >= 128) {
            revert InvalidSlot();
        }

        euint64 weight64 = FHE.fromExternal(encryptedWeight, inputProof);

        euint128 weight = FHE.asEuint128(weight64);

        FHE.allowThis(weight);

        _weights[slotIndex] = weight;
    }

    function beginSnapshotImport(uint256 snapshotId, uint256 participantCount) external {
        engine.beginSnapshotImport(snapshotId, participantCount);
    }

    function syncSnapshotChunk(
        uint256 snapshotId,
        uint256 start,
        uint256 participantCount
    ) external {
        euint128[8] memory chunk;

        for (uint256 offset = 0; offset < 8; ++offset) {
            uint256 slotIndex = start + offset;

            if (slotIndex >= participantCount) {
                chunk[offset] = FHE.asEuint128(0);
                continue;
            }

            euint128 weight = _weights[slotIndex];

            FHE.allowTransient(weight, address(engine));

            chunk[offset] = weight;
        }

        engine.importSnapshotChunk(snapshotId, start, chunk);
    }

    function syncSnapshotChunkWithoutGrant(
        uint256 snapshotId,
        uint256 start,
        uint256 participantCount
    ) external {
        euint128[8] memory chunk;

        for (uint256 offset = 0; offset < 8; ++offset) {
            uint256 slotIndex = start + offset;

            if (slotIndex >= participantCount) {
                chunk[offset] = FHE.asEuint128(0);
                continue;
            }

            chunk[offset] = _weights[slotIndex];
        }

        engine.importSnapshotChunk(snapshotId, start, chunk);
    }

    function sealSnapshotImport(uint256 snapshotId) external {
        engine.sealSnapshotImport(snapshotId);
    }
}
