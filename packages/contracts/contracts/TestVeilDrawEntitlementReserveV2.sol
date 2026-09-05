// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";

import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

interface ITestVeilDrawEntitlementPoolV2 {
    function derivePrizeEntitlement(
        uint256 drawId,
        uint256 slotIndex,
        euint64 prizeAmount
    ) external returns (euint64 entitlement);

    function derivePrizeEntitlementWithoutEngineGrant(
        uint256 drawId,
        uint256 slotIndex,
        euint64 prizeAmount
    ) external returns (euint64 entitlement);
}

/// @notice Test-only Reserve-side ACL probe.
/// @dev Persists only fresh Reserve-owned derivatives.
contract TestVeilDrawEntitlementReserveV2 is ZamaEthereumConfig {
    address public immutable owner;

    ITestVeilDrawEntitlementPoolV2 public immutable pool;

    euint64 private _prizeAmount;

    mapping(uint256 => mapping(uint256 => euint64)) private _storedEntitlements;

    error OnlyOwner();
    error MissingPoolReturnGrant();

    constructor(address pool_) {
        owner = msg.sender;

        pool = ITestVeilDrawEntitlementPoolV2(pool_);
    }

    function setPrize(externalEuint64 encryptedPrize, bytes calldata inputProof) external {
        if (msg.sender != owner) {
            revert OnlyOwner();
        }

        euint64 incoming = FHE.fromExternal(encryptedPrize, inputProof);

        // Persist a Reserve-owned derivative rather than the input handle.
        _prizeAmount = FHE.add(incoming, FHE.asEuint64(0));

        FHE.allowThis(_prizeAmount);
    }

    function deriveAndStore(uint256 drawId, uint256 slotIndex) external returns (euint64 stored) {
        FHE.allowTransient(_prizeAmount, address(pool));

        euint64 incoming = pool.derivePrizeEntitlement(drawId, slotIndex, _prizeAmount);

        if (!FHE.isAllowed(incoming, address(this))) {
            revert MissingPoolReturnGrant();
        }

        // Persist only a fresh Reserve-owned derivative.
        stored = FHE.add(incoming, FHE.asEuint64(0));

        FHE.allowThis(stored);

        _storedEntitlements[drawId][slotIndex] = stored;
    }

    /// @notice Negative-path probe: previous transient Reserve -> Pool ACL
    /// must not survive into a later transaction.
    function deriveWithoutReserveGrant(
        uint256 drawId,
        uint256 slotIndex
    ) external returns (euint64 entitlement) {
        return pool.derivePrizeEntitlement(drawId, slotIndex, _prizeAmount);
    }

    /// @notice Grant Reserve -> Pool but deliberately have Pool omit the
    /// next Pool -> Engine transient grant.
    function deriveWithMissingEngineGrant(
        uint256 drawId,
        uint256 slotIndex
    ) external returns (euint64 entitlement) {
        FHE.allowTransient(_prizeAmount, address(pool));

        return pool.derivePrizeEntitlementWithoutEngineGrant(drawId, slotIndex, _prizeAmount);
    }

    function prizeHandle() external view returns (euint64) {
        return _prizeAmount;
    }

    function storedEntitlementHandle(
        uint256 drawId,
        uint256 slotIndex
    ) external view returns (euint64) {
        return _storedEntitlements[drawId][slotIndex];
    }
}
