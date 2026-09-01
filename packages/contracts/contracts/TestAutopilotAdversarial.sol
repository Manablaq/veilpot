// SPDX-License-Identifier: UNLICENSED
/* solhint-disable */
pragma solidity 0.8.27;

// TEST_ONLY / NOT_PRODUCTION / MUST_NOT_DEPLOY.
// Negative-control fixtures for Gate 2C-C3B2B Autopilot authority and returned-handle tests.
import {FHE, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";
import {TestERC7984} from "./TestERC7984.sol";

interface ITestAutopilotPool {
    function pullAutopilotContribution(
        uint256 slotIndex,
        uint256 reservationNonce,
        euint64 authorizedAmount
    ) external returns (euint64 actualTransferred);
}

/// @dev Pool-immutable test Vault identity that deliberately omits one authority leg at a time.
contract TestAutopilotVaultNegativeHarness is ZamaEthereumConfig {
    IERC7984 private immutable _token;
    ITestAutopilotPool private immutable _pool;

    constructor(IERC7984 token_, ITestAutopilotPool pool_) {
        _token = token_;
        _pool = pool_;
    }

    function pullWithoutOperator(
        uint256 slotIndex,
        uint256 reservationNonce,
        externalEuint64 encryptedAmount,
        bytes calldata inputProof
    ) external returns (euint64) {
        euint64 amount = FHE.fromExternal(encryptedAmount, inputProof);
        FHE.allowTransient(amount, address(_pool));
        return _pool.pullAutopilotContribution(slotIndex, reservationNonce, amount);
    }

    function pullWithoutPoolAcl(
        uint256 slotIndex,
        uint256 reservationNonce,
        externalEuint64 encryptedAmount,
        bytes calldata inputProof
    ) external returns (euint64) {
        euint64 amount = FHE.fromExternal(encryptedAmount, inputProof);
        _token.setOperator(address(_pool), uint48(block.timestamp));
        return _pool.pullAutopilotContribution(slotIndex, reservationNonce, amount);
    }
}

/// @dev Normal during activation/funding; switchable malformed Autopilot return handle afterward.
contract TestAutopilotToggleReturnAclToken is TestERC7984 {
    bool public breakReturnAcl;

    function setBreakReturnAcl(bool value) external {
        breakReturnAcl = value;
    }

    function confidentialTransferFrom(
        address from,
        address to,
        euint64 amount
    ) public override returns (euint64) {
        euint64 transferred = super.confidentialTransferFrom(from, to, amount);

        if (!breakReturnAcl) {
            return transferred;
        }

        return euint64.wrap(keccak256("autopilot-malformed-return-handle"));
    }
}
