// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.27;

/* solhint-disable one-contract-per-file, use-natspec */

// TEST_ONLY / NOT_PRODUCTION / MUST_NOT_DEPLOY.

import {FHE, euint64, euint128, externalEuint128} from "@fhevm/solidity/lib/FHE.sol";

import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

import {IVeilpotPrizeReserveFunding} from "./interfaces/IVeilpotPrizeReserveFunding.sol";

interface ITestVeilpotYieldAdapterV2 {
    function recognizeRoundYield(
        uint256 snapshotId,
        uint256[3] calldata drawIds,
        euint128 rawTotalTwab
    ) external;
}

contract TestVeilpotYieldV2PoolHarness is ZamaEthereumConfig {
    function recognizeRound(
        address adapter,
        uint256 snapshotId,
        uint256[3] calldata drawIds,
        externalEuint128 encryptedRawTotalTwab,
        bytes calldata inputProof
    ) external {
        euint128 rawTotalTwab = FHE.fromExternal(encryptedRawTotalTwab, inputProof);

        FHE.allowTransient(rawTotalTwab, adapter);

        ITestVeilpotYieldAdapterV2(adapter).recognizeRoundYield(snapshotId, drawIds, rawTotalTwab);
    }

    function recognizeRoundWithoutGrant(
        address adapter,
        uint256 snapshotId,
        uint256[3] calldata drawIds,
        externalEuint128 encryptedRawTotalTwab,
        bytes calldata inputProof
    ) external {
        euint128 rawTotalTwab = FHE.fromExternal(encryptedRawTotalTwab, inputProof);

        ITestVeilpotYieldAdapterV2(adapter).recognizeRoundYield(snapshotId, drawIds, rawTotalTwab);
    }
}

contract TestVeilpotYieldV2ReserveHarness is ZamaEthereumConfig {
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
