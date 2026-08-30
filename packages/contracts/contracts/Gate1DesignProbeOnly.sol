// SPDX-License-Identifier: UNLICENSED
// GATE_1_DESIGN_PROBE_ONLY: local mock measurements, NOT_PRODUCTION, MUST_NOT_DEPLOY.
// This fixture exists only to measure candidate FHE operations before production interfaces exist.
/* solhint-disable */
pragma solidity ^0.8.27;

import {
    FHE,
    ebool,
    euint64,
    euint128,
    externalEbool,
    externalEuint64,
    externalEuint128
} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

contract Gate1DesignReserveProbeOnly is ZamaEthereumConfig {
    euint64 private _received;

    function acceptEntitlement(euint64 amount) external {
        _received = amount;
        FHE.allowThis(_received);
    }
}

contract Gate1DesignPullTokenProbeOnly is ZamaEthereumConfig {
    function confidentialTransferFrom(address, address, euint64 amount) external returns (euint64) {
        require(FHE.isAllowed(amount, address(this)), "missing transient token ACL");
        // Exercise the handle as the token itself before returning the actual amount.
        euint64 actual = FHE.add(amount, FHE.asEuint64(0));
        FHE.allowThis(actual);
        FHE.allowTransient(actual, msg.sender);
        return actual;
    }
}

interface IGate1DesignPullTokenProbeOnly {
    function confidentialTransferFrom(
        address from,
        address to,
        euint64 amount
    ) external returns (euint64);
}

contract Gate1DesignProbeOnly is ZamaEthereumConfig {
    euint128 private _last128;
    euint64 private _last64;
    ebool private _lastBool;

    function widen(externalEuint64 input, bytes calldata proof) external {
        euint64 value = FHE.fromExternal(input, proof);
        _last128 = FHE.asEuint128(value);
        FHE.allowThis(_last128);
    }

    function pullDeposit(
        externalEuint64 input,
        bytes calldata proof,
        address token,
        address depositor
    ) external {
        euint64 requested = FHE.fromExternal(input, proof);
        FHE.allowTransient(requested, token);
        euint64 actual = IGate1DesignPullTokenProbeOnly(token).confidentialTransferFrom(
            depositor,
            address(this),
            requested
        );
        FHE.allowThis(actual);
        _last64 = actual;
        _lastBool = FHE.ge(actual, 1_000_000);
        FHE.allowThis(_last64);
        FHE.allowThis(_lastBool);
    }

    /// Negative control: omitting the pool→token transient grant must fail in the token.
    function pullDepositWithoutTokenGrant(
        externalEuint64 input,
        bytes calldata proof,
        address token,
        address depositor
    ) external {
        euint64 requested = FHE.fromExternal(input, proof);
        IGate1DesignPullTokenProbeOnly(token).confidentialTransferFrom(
            depositor,
            address(this),
            requested
        );
    }

    function rawTwab(externalEuint128 input, bytes calldata proof, uint64 elapsed) external {
        euint128 balance = FHE.fromExternal(input, proof);
        _last128 = FHE.mul(balance, elapsed);
        _last128 = FHE.add(_last128, FHE.asEuint128(0));
        FHE.allowThis(_last128);
    }

    /// Draw-TWAB synthetic yield path: bounded euint128 division followed by a proven-safe euint64 cast.
    function yieldFromRawTwab(externalEuint128 input, bytes calldata proof) external {
        euint128 raw = FHE.fromExternal(input, proof);
        euint128 gross = FHE.div(raw, 10_000 * 86_400);
        _last64 = FHE.asEuint64(gross);
        FHE.allowThis(_last64);
    }

    function snapshotChunk(externalEuint128[] calldata inputs, bytes calldata proof) external {
        euint128 sum = FHE.asEuint128(0);
        for (uint256 i = 0; i < inputs.length; i++) {
            sum = FHE.add(sum, FHE.fromExternal(inputs[i], proof));
        }
        _last128 = sum;
        FHE.allowThis(_last128);
    }

    function prefixChunk(
        externalEuint128[] calldata inputs,
        externalEuint128 target,
        bytes calldata proof
    ) external {
        euint128 prefix = FHE.asEuint128(0);
        euint128 targetValue = FHE.fromExternal(target, proof);
        euint128 winnerCount = FHE.asEuint128(0);
        for (uint256 i = 0; i < inputs.length; i++) {
            euint128 afterPrefix = FHE.add(prefix, FHE.fromExternal(inputs[i], proof));
            ebool winner = FHE.and(FHE.le(prefix, targetValue), FHE.lt(targetValue, afterPrefix));
            winnerCount = FHE.add(winnerCount, FHE.asEuint128(winner));
            FHE.allowThis(winner);
            prefix = afterPrefix;
        }
        _last128 = prefix;
        FHE.allowThis(_last128);
        FHE.allowThis(winnerCount);
    }

    function selectEntitlement(
        externalEbool winner,
        externalEuint64 prize,
        bytes calldata proof
    ) external {
        ebool predicate = FHE.fromExternal(winner, proof);
        euint64 amount = FHE.fromExternal(prize, proof);
        _last64 = FHE.select(predicate, amount, FHE.asEuint64(0));
        FHE.allowThis(_last64);
    }

    function residual(
        externalEuint64 remaining,
        externalEuint64 actual,
        bytes calldata proof
    ) external {
        euint64 current = FHE.fromExternal(remaining, proof);
        euint64 spent = FHE.fromExternal(actual, proof);
        _last64 = FHE.sub(current, spent);
        _lastBool = FHE.eq(current, spent);
        FHE.allowThis(_last64);
        FHE.allowThis(_lastBool);
    }

    function handoff(externalEuint64 entitlement, bytes calldata proof, address reserve) external {
        euint64 amount = FHE.fromExternal(entitlement, proof);
        FHE.allowTransient(amount, reserve);
        Gate1DesignReserveProbeOnly(reserve).acceptEntitlement(amount);
    }
}
