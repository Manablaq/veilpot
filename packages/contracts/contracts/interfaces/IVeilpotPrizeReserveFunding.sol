// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {euint64} from "@fhevm/solidity/lib/FHE.sol";

/// @title IVeilpotPrizeReserveFunding
/// @author Veilpot
/// @notice Narrow Gate 1C funding edge from the immutable yield adapter to the prize reserve.
interface IVeilpotPrizeReserveFunding {
    /// @notice Record the ERC-7984 token-returned actual yield transferred for one draw.
    /// @dev The implementation must reject callers other than its immutable yield adapter.
    /// @param drawId Draw whose realized yield was transferred into the reserve.
    /// @param actualTransferred Encrypted amount the ERC-7984 token reports as actually transferred.
    /// @return acknowledgement Exact function selector confirming reserve accounting executed.
    function recordYield(
        uint256 drawId,
        euint64 actualTransferred
    ) external returns (bytes4 acknowledgement);
}
