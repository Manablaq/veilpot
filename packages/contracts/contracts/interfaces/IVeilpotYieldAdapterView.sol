// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";

/// @title IVeilpotYieldAdapterView
/// @author Veilpot
/// @notice Narrow immutable-binding and funding-state surface consumed by the prize reserve.
interface IVeilpotYieldAdapterView {
    /// @notice Return the confidential token bound to the adapter.
    function confidentialToken() external view returns (IERC7984);

    /// @notice Return the immutable pool bound to the adapter.
    function pool() external view returns (address);

    /// @notice Return the immutable prize reserve bound to the adapter.
    function reserve() external view returns (address);

    /// @notice Read only the first public state word from the adapter draw-yield tuple.
    /// @param drawId Draw whose adapter funding state is requested.
    /// @return state Current public yield-funding lifecycle state.
    function drawYieldHandles(uint256 drawId) external view returns (uint8 state);
}
