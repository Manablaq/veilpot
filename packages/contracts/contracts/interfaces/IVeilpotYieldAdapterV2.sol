// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {euint128} from "@fhevm/solidity/lib/FHE.sol";

/// @title IVeilpotYieldAdapterV2
/// @notice Minimal immutable PoolV2 → three-prize yield adapter boundary.
interface IVeilpotYieldAdapterV2 {
    function recognizeRoundYield(
        uint256 snapshotId,
        uint256[3] calldata drawIds,
        euint128 rawTotalTwab
    ) external;
}
