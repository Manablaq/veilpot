// SPDX-License-Identifier: UNLICENSED
/* solhint-disable one-contract-per-file */
pragma solidity 0.8.27;

import {FHE, euint64, euint128, externalEuint128} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";

import {IVeilpotPrizeReserveFunding} from "./interfaces/IVeilpotPrizeReserveFunding.sol";

/*
 * TEST_ONLY / NOT_PRODUCTION / MUST_NOT_DEPLOY.
 *
 * These fixtures exist only to exercise the Gate 1C.2 reserve boundary.
 * Getter names intentionally match the production pool/adapter interfaces.
 */
/* solhint-disable use-natspec */
/* solhint-disable immutable-vars-naming */

interface IGate1CPrizeYieldAdapter {
    function recognizeDrawYield(uint256 drawId, euint128 rawTotalTwab) external;
}

contract Gate1CPrizePoolHarness is ZamaEthereumConfig {
    struct DrawMetadata {
        uint256 snapshotId;
        uint256 snapshotEpochId;
        uint256 participantCount;
        uint256 batchId;
        uint256 winnerCursor;
        uint8 state;
        uint8 bucketExponent;
    }

    IERC7984 public immutable confidentialToken;

    mapping(uint256 => DrawMetadata) private _draws;

    constructor(IERC7984 token) {
        confidentialToken = token;
    }

    function setFinalizedDraw(uint256 drawId, uint256 participantCount) external {
        _draws[drawId] = DrawMetadata({
            state: 8,
            snapshotId: drawId,
            snapshotEpochId: drawId,
            participantCount: participantCount,
            batchId: 1,
            bucketExponent: 1,
            winnerCursor: participantCount
        });
    }

    function setDrawMetadata(
        uint256 drawId,
        uint8 state,
        uint256 snapshotId,
        uint256 snapshotEpochId,
        uint256 participantCount,
        uint256 batchId,
        uint8 bucketExponent,
        uint256 winnerCursor
    ) external {
        _draws[drawId] = DrawMetadata({
            state: state,
            snapshotId: snapshotId,
            snapshotEpochId: snapshotEpochId,
            participantCount: participantCount,
            batchId: batchId,
            bucketExponent: bucketExponent,
            winnerCursor: winnerCursor
        });
    }

    function drawMetadata(
        uint256 drawId
    )
        external
        view
        returns (
            uint8 state,
            uint256 snapshotId,
            uint256 snapshotEpochId,
            uint256 participantCount,
            uint256 batchId,
            uint8 bucketExponent,
            uint256 winnerCursor
        )
    {
        DrawMetadata storage draw = _draws[drawId];

        return (
            draw.state,
            draw.snapshotId,
            draw.snapshotEpochId,
            draw.participantCount,
            draw.batchId,
            draw.bucketExponent,
            draw.winnerCursor
        );
    }

    function recognize(
        address adapter,
        uint256 drawId,
        externalEuint128 encryptedRawTotalTwab,
        bytes calldata inputProof
    ) external {
        euint128 rawTotalTwab = FHE.fromExternal(encryptedRawTotalTwab, inputProof);

        FHE.allowTransient(rawTotalTwab, adapter);

        IGate1CPrizeYieldAdapter(adapter).recognizeDrawYield(drawId, rawTotalTwab);
    }
}

contract Gate1CPrizeAdapterHarness is ZamaEthereumConfig {
    IERC7984 public immutable confidentialToken;
    address public immutable pool;
    address public immutable reserve;

    mapping(uint256 => uint8) private _drawStates;

    constructor(IERC7984 token, address pool_, address reserve_) {
        confidentialToken = token;
        pool = pool_;
        reserve = reserve_;
    }

    function setDrawState(uint256 drawId, uint8 state) external {
        _drawStates[drawId] = state;
    }

    function drawYieldHandles(uint256 drawId) external view returns (uint8 state) {
        return _drawStates[drawId];
    }

    function recordYieldWithAcl(
        uint256 drawId,
        uint64 clearAmount
    ) external returns (bytes4 acknowledgement) {
        euint64 amount = FHE.asEuint64(clearAmount);

        FHE.allowTransient(amount, reserve);

        return IVeilpotPrizeReserveFunding(reserve).recordYield(drawId, amount);
    }

    function recordYieldWithoutAcl(
        uint256 drawId,
        uint64 clearAmount
    ) external returns (bytes4 acknowledgement) {
        euint64 amount = FHE.asEuint64(clearAmount);

        return IVeilpotPrizeReserveFunding(reserve).recordYield(drawId, amount);
    }
}
