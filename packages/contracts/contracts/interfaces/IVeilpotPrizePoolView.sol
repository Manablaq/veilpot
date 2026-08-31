// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {euint64} from "@fhevm/solidity/lib/FHE.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";

/// @title IVeilpotPrizePoolView
/// @author Veilpot
/// @notice Narrow read-only pool surface consumed by the isolated prize reserve.
interface IVeilpotPrizePoolView {
    /// @notice Return the confidential token held by the Veilpot pool.
    function confidentialToken() external view returns (IERC7984);

    /// @notice Return the immutable canonical prize reserve authorized for encrypted handoff.
    function prizeReserve() external view returns (address);

    /// @notice Return the immutable historical beneficiary bound to one snapshot slot.
    /// @param snapshotId Immutable snapshot containing the historical slot.
    /// @param slotIndex Historical slot index within the snapshot.
    /// @return owner Historical beneficiary owner.
    /// @return registrationVersion Historical registration version.
    /// @return reservationNonce Historical reservation nonce.
    /// @return bound Whether the historical beneficiary was frozen for the slot.
    function snapshotBeneficiary(
        uint256 snapshotId,
        uint256 slotIndex
    )
        external
        view
        returns (address owner, uint256 registrationVersion, uint256 reservationNonce, bool bound);

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
    /// @notice Derive one encrypted historical slot entitlement for the canonical reserve.
    /// @param drawId Finalized draw whose winner selector is consumed.
    /// @param slotIndex Historical slot being assigned.
    /// @param prizeAmount Frozen encrypted prize amount transiently granted by the reserve.
    /// @return entitlement Encrypted prize amount for the winner or encrypted zero otherwise.
    function derivePrizeEntitlement(
        uint256 drawId,
        uint256 slotIndex,
        euint64 prizeAmount
    ) external returns (euint64 entitlement);
}
