// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";

/// @title IVeilpotPrizePoolView
/// @author Veilpot
/// @notice Narrow read-only pool surface consumed by the isolated prize reserve.
interface IVeilpotPrizePoolView {
    /// @notice Return the confidential token held by the Veilpot pool.
    function confidentialToken() external view returns (IERC7984);

    /// @notice Return public draw lifecycle metadata without exposing confidential values.
    /// @param drawId Draw whose public lifecycle metadata is requested.
    /// @return state Current public draw state.
    /// @return snapshotId Immutable snapshot consumed by the draw.
    /// @return snapshotEpochId Closing epoch represented by the snapshot.
    /// @return participantCount Frozen participant bound processed by winner resolution.
    /// @return batchId Current or final rejection-sampling batch identifier.
    /// @return bucketExponent Proven public power-of-two bucket exponent.
    /// @return winnerCursor Number of historical participant slots processed for winner resolution.
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
        );
}
