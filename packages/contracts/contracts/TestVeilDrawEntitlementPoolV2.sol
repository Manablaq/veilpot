// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {FHE, euint64} from "@fhevm/solidity/lib/FHE.sol";

import {TestVeilDrawEngineV2Host} from "./TestVeilDrawEngineV2Host.sol";

/// @notice Test-only PoolV2 consequence-boundary probe.
/// @dev
/// This contract has no token custody. It exists only to prove the exact
/// Reserve -> Pool -> Engine -> Pool -> Reserve FHE ACL handoff before the
/// production VeilpotPoolV2 is implemented.
contract TestVeilDrawEntitlementPoolV2 is TestVeilDrawEngineV2Host {
    address public immutable owner;
    address public reserve;

    error OnlyOwner();
    error InvalidReserve();
    error ReserveAlreadyBound();
    error OnlyReserve();
    error MissingReserveGrant();
    error MissingEngineReturnGrant();

    constructor() {
        owner = msg.sender;
    }

    function bindReserve(address reserve_) external {
        if (msg.sender != owner) {
            revert OnlyOwner();
        }

        if (reserve_ == address(0)) {
            revert InvalidReserve();
        }

        if (reserve != address(0)) {
            revert ReserveAlreadyBound();
        }

        reserve = reserve_;
    }

    /// @notice Exact production-shaped Pool-facing entitlement entrypoint.
    function derivePrizeEntitlement(
        uint256 drawId,
        uint256 slotIndex,
        euint64 prizeAmount
    ) external returns (euint64 forwarded) {
        if (msg.sender != reserve) {
            revert OnlyReserve();
        }

        if (!FHE.isAllowed(prizeAmount, address(this))) {
            revert MissingReserveGrant();
        }

        FHE.allowTransient(prizeAmount, address(engine));

        euint64 engineEntitlement = engine.derivePrizeEntitlement(drawId, slotIndex, prizeAmount);

        if (!FHE.isAllowed(engineEntitlement, address(this))) {
            revert MissingEngineReturnGrant();
        }

        // Never persist an Engine-owned return handle. Produce a fresh
        // Pool-owned derivative before crossing the next contract boundary.
        forwarded = FHE.add(engineEntitlement, FHE.asEuint64(0));

        FHE.allowTransient(forwarded, msg.sender);
    }

    /// @notice Negative-path probe: deliberately omit Pool -> Engine ACL.
    function derivePrizeEntitlementWithoutEngineGrant(
        uint256 drawId,
        uint256 slotIndex,
        euint64 prizeAmount
    ) external returns (euint64 entitlement) {
        if (msg.sender != reserve) {
            revert OnlyReserve();
        }

        if (!FHE.isAllowed(prizeAmount, address(this))) {
            revert MissingReserveGrant();
        }

        return engine.derivePrizeEntitlement(drawId, slotIndex, prizeAmount);
    }
}
