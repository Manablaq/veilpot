// SPDX-License-Identifier: UNLICENSED
/* solhint-disable one-contract-per-file, use-natspec */
pragma solidity 0.8.27;

import {FHE, ebool, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

import {IVeilpotPrizePoolView} from "./interfaces/IVeilpotPrizePoolView.sol";

interface IGate1C2BWinnerRecordView {
    function drawWinnerRecord(
        uint256 drawId,
        uint256 slotIndex
    )
        external
        view
        returns (
            ebool winnerPredicate,
            address owner,
            uint256 registrationVersion,
            uint256 reservationNonce,
            bool beneficiaryBound,
            bool processed
        );
}

contract Gate1C2BPrizeReserveHandoffHarness is ZamaEthereumConfig {
    euint64 private _storedEntitlement;

    error MissingEntitlementAcl();

    function deriveWithPrizeAcl(
        IVeilpotPrizePoolView pool,
        uint256 drawId,
        uint256 slotIndex,
        uint64 clearPrize,
        bool persistEntitlement
    ) external returns (bytes32 entitlementHandle) {
        euint64 prizeAmount = FHE.asEuint64(clearPrize);

        FHE.allowTransient(prizeAmount, address(pool));

        euint64 entitlement = pool.derivePrizeEntitlement(drawId, slotIndex, prizeAmount);

        if (!FHE.isAllowed(entitlement, address(this))) {
            revert MissingEntitlementAcl();
        }

        _storedEntitlement = entitlement;

        if (persistEntitlement) {
            FHE.allowThis(_storedEntitlement);
        }

        return FHE.toBytes32(entitlement);
    }

    function deriveWithoutPrizeAcl(
        IVeilpotPrizePoolView pool,
        uint256 drawId,
        uint256 slotIndex,
        uint64 clearPrize
    ) external returns (bytes32 entitlementHandle) {
        euint64 prizeAmount = FHE.asEuint64(clearPrize);

        euint64 entitlement = pool.derivePrizeEntitlement(drawId, slotIndex, prizeAmount);

        return FHE.toBytes32(entitlement);
    }

    function storedEntitlementHandle() external view returns (bytes32) {
        return FHE.toBytes32(_storedEntitlement);
    }

    function storedEntitlementAllowed() external view returns (bool) {
        return FHE.isAllowed(_storedEntitlement, address(this));
    }

    function winnerPredicateAllowed(
        address pool,
        uint256 drawId,
        uint256 slotIndex
    ) external view returns (bool) {
        (ebool winnerPredicate, , , , , ) = IGate1C2BWinnerRecordView(pool).drawWinnerRecord(
            drawId,
            slotIndex
        );

        return FHE.isAllowed(winnerPredicate, address(this));
    }
}
