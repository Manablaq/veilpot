// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {FHE, euint64, euint128, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @notice Test-only probe proving the ACL boundary intended for VeilDraw V2.
/// @dev This contract has no token, custody, claim, or recipient-selection authority.
contract TestVeilDrawV2AclEngine is ZamaEthereumConfig {
    address public immutable pool;

    euint128 private _storedTotal;
    bool public initialized;

    error OnlyPool();
    error MissingPoolGrant();
    error NotInitialized();

    constructor(address pool_) {
        require(pool_ != address(0), "zero pool");
        pool = pool_;
    }

    modifier onlyPool() {
        if (msg.sender != pool) revert OnlyPool();
        _;
    }

    /// @notice Consume a pool-owned ciphertext using only transaction-scoped ACL,
    /// then create an engine-owned persistent ciphertext for later transactions.
    function importTotal(euint128 transientTotal) external onlyPool {
        if (!FHE.isAllowed(transientTotal, address(this))) {
            revert MissingPoolGrant();
        }

        _storedTotal = FHE.add(transientTotal, FHE.asEuint128(0));

        FHE.allowThis(_storedTotal);
        initialized = true;
    }

    /// @notice Prove the engine-owned derived ciphertext remains usable later.
    function bumpStoredTotal() external onlyPool {
        if (!initialized) revert NotInitialized();

        _storedTotal = FHE.add(_storedTotal, FHE.asEuint128(1));

        FHE.allowThis(_storedTotal);
    }

    /// @notice Return a fresh derived ciphertext to the Pool using transient ACL only.
    function exportTotal() external onlyPool returns (euint128 result) {
        if (!initialized) revert NotInitialized();

        result = FHE.add(_storedTotal, FHE.asEuint128(0));

        FHE.allowTransient(result, msg.sender);
    }

    function storedTotalHandle() external view returns (euint128) {
        return _storedTotal;
    }
}

/// @notice Test-only Pool-side host for the VeilDraw V2 ACL probe.
contract TestVeilDrawV2AclHost is ZamaEthereumConfig {
    TestVeilDrawV2AclEngine public immutable engine;

    euint128 private _receivedTotal;

    error MissingEngineGrant();

    constructor() {
        engine = new TestVeilDrawV2AclEngine(address(this));
    }

    /// @notice Parse one user input at the Pool boundary and transiently authorize only the engine.
    function importAndForward(externalEuint64 encryptedValue, bytes calldata inputProof) external {
        euint64 value64 = FHE.fromExternal(encryptedValue, inputProof);

        euint128 widened = FHE.asEuint128(value64);

        FHE.allowTransient(widened, address(engine));

        engine.importTotal(widened);
    }

    /// @notice Negative control: intentionally omit the transient engine grant.
    function importWithoutGrant(
        externalEuint64 encryptedValue,
        bytes calldata inputProof
    ) external {
        euint64 value64 = FHE.fromExternal(encryptedValue, inputProof);

        euint128 widened = FHE.asEuint128(value64);

        engine.importTotal(widened);
    }

    function bumpEngineTotal() external {
        engine.bumpStoredTotal();
    }

    /// @notice Pull a transient engine ciphertext back and persist only a fresh Pool-owned derivative.
    function pullEngineTotal() external {
        euint128 returned = engine.exportTotal();

        if (!FHE.isAllowed(returned, address(this))) {
            revert MissingEngineGrant();
        }

        _receivedTotal = FHE.add(returned, FHE.asEuint128(0));

        FHE.allowThis(_receivedTotal);
    }

    function receivedTotalHandle() external view returns (euint128) {
        return _receivedTotal;
    }
}
