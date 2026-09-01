// SPDX-License-Identifier: UNLICENSED
/* solhint-disable */
pragma solidity 0.8.27;

// TEST_ONLY / NOT_PRODUCTION / MUST_NOT_DEPLOY.
// Concrete executable harness for the exact pinned OpenZeppelin Confidential Contracts 0.5.3 ERC7984.
import {FHE, ebool, euint64, externalEuint64} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {ERC7984} from "@openzeppelin/confidential-contracts/token/ERC7984/ERC7984.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";

contract TestERC7984 is ERC7984, ZamaEthereumConfig {
    constructor() ERC7984("Veilpot Test Confidential Token", "vTEST", "") {}

    function mint(address to, externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        _update(address(0), to, FHE.fromExternal(encryptedAmount, inputProof));
    }

    function mintClear(address to, uint64 amount) external {
        _update(address(0), to, FHE.asEuint64(amount));
    }
}

/// @dev Test-only caller proving the exact token overload requires caller ACL.
contract TestERC7984NoAclCaller is ZamaEthereumConfig {
    function pullWithoutGrant(
        IERC7984 token,
        address from,
        externalEuint64 encryptedAmount,
        bytes calldata inputProof
    ) external returns (euint64) {
        euint64 amount = FHE.fromExternal(encryptedAmount, inputProof);
        return token.confidentialTransferFrom(from, address(this), amount);
    }
}

/// @dev TEST_ONLY / NOT_PRODUCTION / MUST_NOT_DEPLOY: externally paused token fixture.
contract TestERC7984Pausable is TestERC7984 {
    bool public paused;

    function setPaused(bool value) external {
        paused = value;
    }

    function _update(address from, address to, euint64 amount) internal override returns (euint64) {
        require(!paused, "TOKEN_PAUSED");
        return super._update(from, to, amount);
    }
}

/// @dev TEST_ONLY / NOT_PRODUCTION / MUST_NOT_DEPLOY: token-side reentrancy fixture.
contract TestERC7984Reentrant is TestERC7984 {
    address public reentryTarget;
    bytes public reentryPayload;
    bool public reentryEnabled;
    bool public lastReentrySucceeded;

    function configureReentry(address target, bytes calldata payload, bool enabled) external {
        reentryTarget = target;
        reentryPayload = payload;
        reentryEnabled = enabled;
    }

    function _update(address from, address to, euint64 amount) internal override returns (euint64) {
        if (reentryEnabled && reentryTarget != address(0)) {
            (lastReentrySucceeded, ) = reentryTarget.call(reentryPayload);
        }
        return super._update(from, to, amount);
    }
}

/// @dev TEST_ONLY / NOT_PRODUCTION / MUST_NOT_DEPLOY: returns an unusable handle and omits return ACL.
contract TestERC7984NoReturnAcl is TestERC7984 {
    function confidentialTransferFrom(
        address from,
        address to,
        euint64 amount
    ) public override returns (euint64) {
        require(FHE.isAllowed(amount, msg.sender), "MISSING_CALLER_ACL");
        require(isOperator(from, msg.sender), "UNAUTHORIZED_OPERATOR");
        _transfer(from, to, amount);
        return euint64.wrap(keccak256("malformed-return-handle"));
    }
}

/// @dev TEST_ONLY / NOT_PRODUCTION / MUST_NOT_DEPLOY: deliberately caps actual transfers.
/// This is not representative of the pinned Zama token's all-or-nothing behavior.
/// @dev TEST_ONLY / NOT_PRODUCTION / MUST_NOT_DEPLOY: direct payout returns an unusable handle.
contract TestERC7984DirectNoReturnAcl is TestERC7984 {
    function confidentialTransfer(address to, euint64 amount) public override returns (euint64) {
        require(FHE.isAllowed(amount, msg.sender), "MISSING_CALLER_ACL");
        _transfer(msg.sender, to, amount);
        return euint64.wrap(keccak256("malformed-direct-return-handle"));
    }
}

contract TestERC7984PartialReturn is TestERC7984 {
    uint64 public partialCap;

    constructor(uint64 cap) {
        partialCap = cap;
    }

    function setPartialCap(uint64 cap) external {
        partialCap = cap;
    }

    function _update(address from, address to, euint64 amount) internal override returns (euint64) {
        euint64 cap = FHE.asEuint64(partialCap);
        ebool withinCap = FHE.le(amount, cap);
        euint64 effectiveAmount = FHE.select(withinCap, amount, cap);
        return super._update(from, to, effectiveAmount);
    }
}

interface IVeilpotBondActions {
    function reserveParticipantSlot() external payable returns (uint256);
    function withdrawBond() external;
}

/// @dev TEST_ONLY / NOT_PRODUCTION / MUST_NOT_DEPLOY: rejects ETH bond delivery.
contract TestRejectingBondReceiver {
    function reserve(address pool) external payable returns (uint256) {
        return IVeilpotBondActions(pool).reserveParticipantSlot{value: msg.value}();
    }

    function withdraw(address pool) external {
        IVeilpotBondActions(pool).withdrawBond();
    }

    receive() external payable {
        revert("REJECT_ETH");
    }
}

/// @dev TEST_ONLY / NOT_PRODUCTION / MUST_NOT_DEPLOY: attempts reentrant bond withdrawal.
contract TestReentrantBondReceiver {
    address public immutable pool;
    bool public nestedCallSucceeded;

    constructor(address pool_) {
        pool = pool_;
    }

    function reserve() external payable returns (uint256) {
        return IVeilpotBondActions(pool).reserveParticipantSlot{value: msg.value}();
    }

    function withdraw() external {
        IVeilpotBondActions(pool).withdrawBond();
    }

    receive() external payable {
        (nestedCallSucceeded, ) = pool.call(
            abi.encodeWithSelector(IVeilpotBondActions.withdrawBond.selector)
        );
    }
}
