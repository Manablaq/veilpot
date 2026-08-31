// SPDX-License-Identifier: UNLICENSED
/* solhint-disable one-contract-per-file */
pragma solidity 0.8.27;

/*
 * This file intentionally groups several minimal test fixtures and omits
 * production-facing NatSpec because none of these contracts may be deployed.
 */
/* solhint-disable use-natspec */

/*
 * TEST_ONLY / NOT_PRODUCTION / MUST_NOT_DEPLOY.
 * Exact Gate 1C pool→adapter and adapter→reserve ACL harness.
 */

import {FHE, euint64, euint128, externalEuint128} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IVeilpotPrizeReserveFunding} from "./interfaces/IVeilpotPrizeReserveFunding.sol";

interface IGate1CYieldAdapterHarness {
    function recognizeDrawYield(uint256 drawId, euint128 rawTotalTwab) external;
}

contract Gate1CYieldPoolHarness is ZamaEthereumConfig {
    function recognize(
        address adapter,
        uint256 drawId,
        externalEuint128 encryptedRawTotalTwab,
        bytes calldata inputProof
    ) external {
        euint128 rawTotalTwab = FHE.fromExternal(encryptedRawTotalTwab, inputProof);

        FHE.allowTransient(rawTotalTwab, adapter);

        IGate1CYieldAdapterHarness(adapter).recognizeDrawYield(drawId, rawTotalTwab);
    }

    function recognizeWithoutGrant(
        address adapter,
        uint256 drawId,
        externalEuint128 encryptedRawTotalTwab,
        bytes calldata inputProof
    ) external {
        euint128 rawTotalTwab = FHE.fromExternal(encryptedRawTotalTwab, inputProof);

        IGate1CYieldAdapterHarness(adapter).recognizeDrawYield(drawId, rawTotalTwab);
    }
}

contract Gate1CYieldReserveHarness is ZamaEthereumConfig {
    mapping(uint256 => euint64) private _received;

    function recordYield(
        uint256 drawId,
        euint64 actualTransferred
    ) external returns (bytes4 acknowledgement) {
        require(FHE.isAllowed(actualTransferred, address(this)), "MISSING_RESERVE_ACL");

        euint64 current = _received[drawId];

        if (!FHE.isInitialized(current)) {
            current = FHE.asEuint64(0);
        }

        _received[drawId] = FHE.add(current, actualTransferred);

        FHE.allowThis(_received[drawId]);

        return IVeilpotPrizeReserveFunding.recordYield.selector;
    }

    function receivedHandle(uint256 drawId) external view returns (euint64) {
        return _received[drawId];
    }
}

/// @dev TEST_ONLY / NOT_PRODUCTION / MUST_NOT_DEPLOY.
/// Deliberately returns an invalid accounting acknowledgement.
contract Gate1CYieldWrongAckReserveHarness is ZamaEthereumConfig {
    function recordYield(
        uint256,
        euint64 actualTransferred
    ) external view returns (bytes4 acknowledgement) {
        require(FHE.isAllowed(actualTransferred, address(this)), "MISSING_RESERVE_ACL");

        return 0xdeadbeef;
    }
}
