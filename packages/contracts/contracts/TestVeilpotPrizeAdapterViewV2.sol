// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";

import {IVeilpotYieldAdapterView} from "./interfaces/IVeilpotYieldAdapterView.sol";

/// @notice Test-only immutable adapter-view probe for PoolV2/PrizeReserve ACL integration.
/// @dev
/// - No token transfer function.
/// - No yield recognition.
/// - No accounting.
/// - Reports FUNDING_FINALIZED solely so Gate 8A can isolate the unchanged
///   PrizeReserve -> PoolV2 -> Engine entitlement boundary.
/// - This is NOT the production V2 yield adapter.
contract TestVeilpotPrizeAdapterViewV2 is IVeilpotYieldAdapterView {
    uint8 public constant FUNDING_FINALIZED = 4;

    IERC7984 public immutable override confidentialToken;

    address public immutable override pool;

    address public immutable override reserve;

    constructor(IERC7984 token_, address pool_, address reserve_) {
        require(address(token_) != address(0), "TOKEN");

        require(pool_ != address(0), "POOL");

        require(reserve_ != address(0), "RESERVE");

        confidentialToken = token_;

        pool = pool_;

        reserve = reserve_;
    }

    function drawYieldHandles(uint256) external pure override returns (uint8 state) {
        return FUNDING_FINALIZED;
    }
}
