// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import {
    FHE,
    ebool,
    euint64,
    euint128,
    euint256,
    externalEuint64
} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {IERC7984} from "@openzeppelin/confidential-contracts/interfaces/IERC7984.sol";

import {IVeilpotPrizeReserveFunding} from "./interfaces/IVeilpotPrizeReserveFunding.sol";

/*
 * Preserve the established public getter names and event topic layout.
 * Renaming the immutables or changing event indexing would alter the public ABI.
 */
/* solhint-disable immutable-vars-naming, gas-indexed-events */

/// @title VeilpotSimulatedYieldAdapter
/// @author Veilpot
/// @notice Deterministic, explicitly demo-only yield source for the Veilpot Sepolia competition build.
/// @dev SIMULATED_YIELD_FOR_SEPOLIA_DEMO. This contract does not represent production DeFi yield.
contract VeilpotSimulatedYieldAdapter is ZamaEthereumConfig {
    /// @notice Basis-points denominator used by the deterministic demo yield formula.
    uint128 public constant BPS_DENOMINATOR = 10_000;

    /// @notice Number of seconds in the fixed one-day yield interval.
    uint128 public constant DAY_SECONDS = 86_400;

    /// @notice Combined denominator for one basis point of yield per day.
    uint128 public constant YIELD_DENOMINATOR = BPS_DENOMINATOR * DAY_SECONDS;

    /// @notice Fixed simulated yield rate in basis points per day.
    uint64 public constant RATE_BPS_PER_DAY = 1;

    /// @notice Maximum gross synthetic yield permitted by Veilpot's frozen Gate 1 envelope.
    uint64 public constant MAX_GROSS_SYNTHETIC_YIELD = 384_000_000_000;

    /// @notice Explicit machine-readable marker identifying this adapter as Sepolia simulated yield.
    bytes32 public constant YIELD_PROFILE = bytes32("SIMULATED_YIELD_FOR_SEPOLIA_DEMO");

    enum YieldState {
        NONE,
        RECOGNITION_PROOF_PENDING,
        RECOGNIZED,
        SWEEP_PROOF_PENDING,
        FUNDING_FINALIZED
    }

    struct DrawYield {
        YieldState state;
        bool recognized;
        uint256 sweepAttemptNonce;
        euint64 grossYield;
        euint64 recognizedYield;
        euint64 remainingUnswept;
        ebool statusPredicate;
        euint256 proofContext;
    }

    /// @notice Confidential ERC-7984 token holding only explicitly funded synthetic-yield liquidity.
    IERC7984 public immutable confidentialToken;

    /// @notice Immutable Veilpot pool authorized to recognize draw yield.
    address public immutable pool;

    /// @notice Immutable prize reserve receiving realized synthetic yield.
    address public immutable reserve;

    /// @notice Next application-level funding nonce accepted for each funder.
    mapping(address => uint256) public nextFundingNonce;
    mapping(uint256 => DrawYield) private _drawYields;

    euint64 private _fundedYieldLiquidity;
    euint64 private _committedUnswept;

    uint256 private _entered;

    error InvalidToken();
    error InvalidPool();
    error InvalidReserve();
    error Reentrancy();
    error CallerFunderMismatch();
    error OperatorUnauthorized();
    error FundingNonceMismatch();
    error OnlyPool();
    error MissingPoolAcl();
    error YieldAlreadyRecognized();
    error UnknownDrawYield();
    error InvalidYieldState(YieldState expected, YieldState actual);
    error SweepAttemptMismatch();
    error InvalidReserveAcknowledgement();

    /// @notice Emitted after dedicated non-principal yield liquidity is successfully pulled.
    /// @param funder Address that supplied the dedicated yield liquidity.
    /// @param fundingNonce Application funding nonce consumed by the successful pull.
    event YieldLiquidityFunded(address indexed funder, uint256 indexed fundingNonce);

    /// @notice Emitted after deterministic synthetic yield is recognized for a draw.
    /// @param drawId Draw whose synthetic yield was recognized.
    event DrawYieldRecognized(uint256 indexed drawId);

    /// @notice Emitted after the zero-yield recognition proof is settled.
    /// @param drawId Draw whose recognition proof was settled.
    /// @param zeroYield Whether the recognized encrypted yield proved to be zero.
    event DrawYieldRecognitionSettled(uint256 indexed drawId, bool zeroYield);

    /// @notice Emitted when one transfer attempt to the prize reserve begins.
    /// @param drawId Draw whose recognized yield is being swept.
    /// @param sweepAttemptNonce Monotonic attempt nonce bound into the sweep proof context.
    event DrawYieldSweepStarted(uint256 indexed drawId, uint256 indexed sweepAttemptNonce);

    /// @notice Emitted after one sweep residual proof is settled.
    /// @param drawId Draw whose sweep proof was settled.
    /// @param sweepAttemptNonce Attempt nonce proven by the supplied decryption proof.
    /// @param complete Whether the encrypted unswept residual proved to be zero.
    event DrawYieldSweepSettled(
        uint256 indexed drawId,
        uint256 indexed sweepAttemptNonce,
        bool complete
    );

    modifier nonReentrant() {
        if (_entered != 0) revert Reentrancy();
        _entered = 1;
        _;
        _entered = 0;
    }

    modifier onlyPool() {
        if (msg.sender != pool) revert OnlyPool();
        _;
    }

    /// @notice Bind this demo adapter permanently to one token, pool, and reserve.
    /// @param token Confidential ERC-7984 token used for funded yield liquidity.
    /// @param pool_ Veilpot pool authorized to recognize draw yield.
    /// @param reserve_ Prize reserve authorized to receive realized yield.
    constructor(IERC7984 token, address pool_, address reserve_) {
        if (address(token) == address(0)) revert InvalidToken();
        if (pool_ == address(0)) revert InvalidPool();
        if (reserve_ == address(0)) revert InvalidReserve();

        confidentialToken = token;
        pool = pool_;
        reserve = reserve_;

        _fundedYieldLiquidity = FHE.asEuint64(0);
        _committedUnswept = FHE.asEuint64(0);

        FHE.allowThis(_fundedYieldLiquidity);
        FHE.allowThis(_committedUnswept);
    }

    /// @notice Pull explicitly dedicated non-principal liquidity into the simulated-yield adapter.
    /// @dev Raw/direct token sends do not call this function and therefore never become funded yield.
    /// @param encryptedAmount Encrypted requested funding amount supplied through the FHE input path.
    /// @param inputProof Proof binding the encrypted input to this call domain.
    /// @param funder Token holder supplying the dedicated non-principal liquidity.
    /// @param fundingNonce Expected application-level nonce for the funder.
    function fundYieldLiquidity(
        externalEuint64 encryptedAmount,
        bytes calldata inputProof,
        address funder,
        uint256 fundingNonce
    ) external nonReentrant {
        if (msg.sender != funder) revert CallerFunderMismatch();
        if (fundingNonce != nextFundingNonce[funder]) revert FundingNonceMismatch();
        if (!confidentialToken.isOperator(funder, address(this))) revert OperatorUnauthorized();

        euint64 requested = FHE.fromExternal(encryptedAmount, inputProof);
        FHE.allowTransient(requested, address(confidentialToken));

        euint64 actualTransferred = confidentialToken.confidentialTransferFrom(
            funder,
            address(this),
            requested
        );

        _fundedYieldLiquidity = FHE.add(_fundedYieldLiquidity, actualTransferred);
        FHE.allowThis(_fundedYieldLiquidity);

        nextFundingNonce[funder] = fundingNonce + 1;

        emit YieldLiquidityFunded(funder, fundingNonce);
    }

    /// @notice Recognize one draw's deterministic synthetic yield from its immutable raw TWAB.
    /// @dev Called only by the immutable pool after granting this adapter access to rawTotalTwab.
    /// @param drawId Draw receiving the deterministic synthetic-yield recognition.
    /// @param rawTotalTwab Encrypted immutable aggregate TWAB supplied by the pool.
    function recognizeDrawYield(
        uint256 drawId,
        euint128 rawTotalTwab
    ) external onlyPool nonReentrant {
        if (_drawYields[drawId].recognized) revert YieldAlreadyRecognized();
        if (!FHE.isAllowed(rawTotalTwab, address(this))) revert MissingPoolAcl();

        euint128 gross128 = FHE.div(rawTotalTwab, YIELD_DENOMINATOR);
        euint128 boundedGross128 = FHE.min(gross128, uint128(MAX_GROSS_SYNTHETIC_YIELD));
        euint64 grossYield = FHE.asEuint64(boundedGross128);

        euint64 recognizedYield = FHE.min(grossYield, _fundedYieldLiquidity);

        _fundedYieldLiquidity = FHE.sub(_fundedYieldLiquidity, recognizedYield);
        _committedUnswept = FHE.add(_committedUnswept, recognizedYield);

        FHE.allowThis(_fundedYieldLiquidity);
        FHE.allowThis(_committedUnswept);

        DrawYield storage draw = _drawYields[drawId];

        draw.state = YieldState.RECOGNITION_PROOF_PENDING;
        draw.recognized = true;
        draw.grossYield = grossYield;
        draw.recognizedYield = recognizedYield;
        draw.remainingUnswept = recognizedYield;
        draw.statusPredicate = FHE.eq(recognizedYield, FHE.asEuint64(0));
        draw.proofContext = FHE.asEuint256(_proofContext(1, drawId, 0));

        FHE.allowThis(draw.grossYield);
        FHE.allowThis(draw.recognizedYield);
        FHE.allowThis(draw.remainingUnswept);
        FHE.allowThis(draw.statusPredicate);
        FHE.allowThis(draw.proofContext);

        // Only the zero/non-zero status and immutable proof context are disclosed.
        FHE.makePubliclyDecryptable(draw.statusPredicate);
        FHE.makePubliclyDecryptable(draw.proofContext);

        emit DrawYieldRecognized(drawId);
    }

    /// @notice Settle the public zero-yield predicate without touching the token.
    /// @dev A zero-yield draw terminates without depending on wrapper transfer liveness.
    /// @param drawId Draw whose recognition proof is being settled.
    /// @param clearZeroYield Publicly decrypted zero-yield predicate.
    /// @param decryptionProof KMS proof over the exact status and application proof context.
    function settleRecognition(
        uint256 drawId,
        bool clearZeroYield,
        bytes calldata decryptionProof
    ) external nonReentrant {
        DrawYield storage draw = _drawYield(drawId);

        if (draw.state != YieldState.RECOGNITION_PROOF_PENDING) {
            revert InvalidYieldState(YieldState.RECOGNITION_PROOF_PENDING, draw.state);
        }

        bytes32[] memory handles = new bytes32[](2);
        handles[0] = FHE.toBytes32(draw.statusPredicate);
        handles[1] = FHE.toBytes32(draw.proofContext);

        FHE.checkSignatures(
            handles,
            abi.encode(clearZeroYield, _proofContext(1, drawId, 0)),
            decryptionProof
        );

        draw.state = clearZeroYield ? YieldState.FUNDING_FINALIZED : YieldState.RECOGNIZED;

        emit DrawYieldRecognitionSettled(drawId, clearZeroYield);
    }

    /// @notice Attempt to transfer the current recognized-yield residual into the immutable reserve.
    /// @dev Accounting uses only the ERC-7984 token-returned actual transfer.
    /// @param drawId Draw whose current recognized-yield residual is being transferred.
    function sweepYield(uint256 drawId) external nonReentrant {
        DrawYield storage draw = _drawYield(drawId);

        if (draw.state != YieldState.RECOGNIZED) {
            revert InvalidYieldState(YieldState.RECOGNIZED, draw.state);
        }

        uint256 attemptNonce = ++draw.sweepAttemptNonce;
        euint64 requested = draw.remainingUnswept;

        FHE.allowThis(requested);
        FHE.allowTransient(requested, address(confidentialToken));

        euint64 actualTransferred = confidentialToken.confidentialTransfer(reserve, requested);

        draw.remainingUnswept = FHE.sub(draw.remainingUnswept, actualTransferred);
        _committedUnswept = FHE.sub(_committedUnswept, actualTransferred);

        FHE.allowThis(draw.remainingUnswept);
        FHE.allowThis(_committedUnswept);

        // The reserve records exactly the same encrypted amount that the
        // token reported as actually transferred.
        FHE.allowTransient(actualTransferred, reserve);
        bytes4 acknowledgement = IVeilpotPrizeReserveFunding(reserve).recordYield(
            drawId,
            actualTransferred
        );

        if (acknowledgement != IVeilpotPrizeReserveFunding.recordYield.selector) {
            revert InvalidReserveAcknowledgement();
        }

        draw.statusPredicate = FHE.eq(draw.remainingUnswept, FHE.asEuint64(0));
        draw.proofContext = FHE.asEuint256(_proofContext(2, drawId, attemptNonce));
        draw.state = YieldState.SWEEP_PROOF_PENDING;

        FHE.allowThis(draw.statusPredicate);
        FHE.allowThis(draw.proofContext);
        FHE.makePubliclyDecryptable(draw.statusPredicate);
        FHE.makePubliclyDecryptable(draw.proofContext);

        emit DrawYieldSweepStarted(drawId, attemptNonce);
    }

    /// @notice Settle one sweep residual proof.
    /// @param drawId Draw whose sweep residual proof is being settled.
    /// @param sweepAttemptNonce Exact transfer-attempt nonce bound into the proof context.
    /// @param clearComplete Publicly decrypted predicate indicating whether the residual is zero.
    /// @param decryptionProof KMS proof over the exact completion predicate and proof context.
    function settleSweepCompletion(
        uint256 drawId,
        uint256 sweepAttemptNonce,
        bool clearComplete,
        bytes calldata decryptionProof
    ) external nonReentrant {
        DrawYield storage draw = _drawYield(drawId);

        if (draw.state != YieldState.SWEEP_PROOF_PENDING) {
            revert InvalidYieldState(YieldState.SWEEP_PROOF_PENDING, draw.state);
        }

        if (sweepAttemptNonce != draw.sweepAttemptNonce) {
            revert SweepAttemptMismatch();
        }

        bytes32[] memory handles = new bytes32[](2);
        handles[0] = FHE.toBytes32(draw.statusPredicate);
        handles[1] = FHE.toBytes32(draw.proofContext);

        FHE.checkSignatures(
            handles,
            abi.encode(clearComplete, _proofContext(2, drawId, sweepAttemptNonce)),
            decryptionProof
        );

        draw.state = clearComplete ? YieldState.FUNDING_FINALIZED : YieldState.RECOGNIZED;

        emit DrawYieldSweepSettled(drawId, sweepAttemptNonce, clearComplete);
    }

    /// @notice Return encrypted global synthetic-yield liquidity accounting handles.
    /// @return fundedYieldLiquidity Dedicated funded liquidity not yet committed to a draw.
    /// @return committedUnswept Recognized yield still committed to unfinished reserve sweeps.
    function liquidityHandles()
        external
        view
        returns (euint64 fundedYieldLiquidity, euint64 committedUnswept)
    {
        return (_fundedYieldLiquidity, _committedUnswept);
    }

    /// @notice Return encrypted yield lifecycle handles and public state metadata for one draw.
    /// @param drawId Draw whose yield lifecycle is being inspected.
    /// @return state Current public yield lifecycle state.
    /// @return grossYield Encrypted capped gross synthetic yield.
    /// @return recognizedYield Encrypted yield backed by dedicated funded liquidity.
    /// @return remainingUnswept Encrypted recognized yield not yet transferred to the reserve.
    /// @return statusPredicate Encrypted zero/completion predicate used by the current proof stage.
    /// @return proofContext Publicly decryptable application-domain proof context.
    /// @return sweepAttemptNonce Current monotonic reserve-sweep attempt nonce.
    function drawYieldHandles(
        uint256 drawId
    )
        external
        view
        returns (
            YieldState state,
            euint64 grossYield,
            euint64 recognizedYield,
            euint64 remainingUnswept,
            ebool statusPredicate,
            bytes32 proofContext,
            uint256 sweepAttemptNonce
        )
    {
        DrawYield storage draw = _drawYield(drawId);

        return (
            draw.state,
            draw.grossYield,
            draw.recognizedYield,
            draw.remainingUnswept,
            draw.statusPredicate,
            FHE.toBytes32(draw.proofContext),
            draw.sweepAttemptNonce
        );
    }

    function _drawYield(uint256 drawId) internal view returns (DrawYield storage draw) {
        draw = _drawYields[drawId];

        if (!draw.recognized) revert UnknownDrawYield();
    }

    function _proofContext(
        uint8 stage,
        uint256 drawId,
        uint256 attemptNonce
    ) internal view returns (uint256) {
        return
            uint256(
                keccak256(
                    abi.encode(
                        bytes32("VEILPOT_YIELD_PROOF_V1"),
                        block.chainid,
                        address(this),
                        pool,
                        reserve,
                        stage,
                        drawId,
                        attemptNonce
                    )
                )
            );
    }
}
