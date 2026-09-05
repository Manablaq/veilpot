import assert from "node:assert/strict";
import test from "node:test";

import { encodeFunctionData } from "viem";

import {
  PARTICIPANT_STATE,
  SUPPORTED_REGISTRATION_VERSION,
  VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT,
  VEILPOT_POOL_V2_ABI,
  buildV2DepositCall,
  type EncryptedEuint64Input,
} from "@veilpot/protocol-sdk";

import {
  createDepositReview,
  depositReviewInvalidReason,
  depositTransactionInvalidReason,
} from "./deposit-review";
import {
  createOperatorApprovalReview,
  operatorApprovalReviewInvalidReason,
} from "./operator-approval";
import {
  createThresholdSettlementReview,
  thresholdReviewInvalidReason,
  thresholdSettlementTransactionInvalidReason,
} from "./threshold-settlement";

const USER = "0x1111111111111111111111111111111111111111" as const;

const WRONG_CONTRACT = "0x2222222222222222222222222222222222222222" as const;

const THRESHOLD_HANDLE = `0x${"11".repeat(32)}` as const;

const PROOF = "0x1234" as const;

const participant = {
  slotIndex: 4n,
  state: PARTICIPANT_STATE.RESERVED,
  owner: USER,
  registrationVersion: SUPPORTED_REGISTRATION_VERSION,
  reservationNonce: 7n,
  reservationExpiry: 10_000n,
  activationStartedAt: 0n,
  activationDeadline: 0n,
  refundAttemptNonce: 0n,
  bondHeld: true,
} as const;

void test("binds the operator review to the active V2 token and Pool", () => {
  const review = createOperatorApprovalReview({
    holder: USER,
    token: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.confidentialToken,
    operator: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
    chainId: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
    participant,
    nowSeconds: 1_000,
  });

  assert.equal(
    review.token.toLowerCase(),
    VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.confidentialToken.toLowerCase(),
  );

  assert.equal(review.operator.toLowerCase(), VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool.toLowerCase());

  assert.equal(
    operatorApprovalReviewInvalidReason(review, {
      holder: USER,
      token: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.confidentialToken,
      operator: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
      chainId: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
      participant,
      nowSeconds: 1_001,
    }),
    null,
  );

  assert.notEqual(
    operatorApprovalReviewInvalidReason(review, {
      holder: USER,
      token: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.confidentialToken,
      operator: WRONG_CONTRACT,
      chainId: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
      participant,
      nowSeconds: 1_001,
    }),
    null,
  );
});

void test("accepts only PoolV2/user-bound encrypted deposit input", () => {
  const encrypted: EncryptedEuint64Input = {
    encryptedValue: "0x1212121212121212121212121212121212121212121212121212121212121212",
    inputProof: "0x34",
    contractAddress: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
    userAddress: USER,
  };

  const descriptor = buildV2DepositCall({
    encrypted,
    depositor: USER,
    reservationNonce: participant.reservationNonce,
    depositNonce: 3n,
  });

  assert.equal(
    descriptor.address.toLowerCase(),
    VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool.toLowerCase(),
  );

  assert.throws(() => {
    buildV2DepositCall({
      encrypted: {
        ...encrypted,
        contractAddress: WRONG_CONTRACT,
      },
      depositor: USER,
      reservationNonce: participant.reservationNonce,
      depositNonce: 3n,
    });
  });

  assert.throws(() => {
    buildV2DepositCall({
      encrypted: {
        ...encrypted,
        userAddress: WRONG_CONTRACT,
      },
      depositor: USER,
      reservationNonce: participant.reservationNonce,
      depositNonce: 3n,
    });
  });
});

void test("freezes the V2 participant, amount, operator, deposit nonce, wallet nonce and calldata", () => {
  const encrypted: EncryptedEuint64Input = {
    encryptedValue: "0x1212121212121212121212121212121212121212121212121212121212121212",
    inputProof: "0x34",
    contractAddress: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
    userAddress: USER,
  };

  const descriptor = buildV2DepositCall({
    encrypted,
    depositor: USER,
    reservationNonce: participant.reservationNonce,
    depositNonce: 3n,
  });

  const calldata = encodeFunctionData({
    abi: descriptor.abi,
    functionName: descriptor.functionName,
    args: descriptor.args,
  });

  const review = createDepositReview({
    holder: USER,
    token: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.confidentialToken,
    pool: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
    chainId: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
    participant,
    amountBaseUnits: 1_000_000n,
    amountDisplay: "1",
    tokenSymbol: "cUSDT",
    tokenDecimals: 6,
    depositNonce: 3n,
    accountNonce: 12,
    encryptedValue: encrypted.encryptedValue,
    inputProof: encrypted.inputProof,
    calldata,
    preparedAt: 1_000,
    simulatedAt: 1_000,
  });

  const exactContext = {
    holder: USER,
    chainId: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
    participant,
    amountBaseUnits: 1_000_000n,
    depositNonce: 3n,
    accountNonce: 12,
    operatorActive: true,
    currentCalldata: calldata,
    nowSeconds: 1_001,
  } as const;

  assert.equal(depositReviewInvalidReason(review, exactContext), null);

  assert.notEqual(
    depositReviewInvalidReason(review, {
      ...exactContext,
      operatorActive: false,
    }),
    null,
  );

  assert.notEqual(
    depositReviewInvalidReason(review, {
      ...exactContext,
      depositNonce: 4n,
    }),
    null,
  );

  assert.notEqual(
    depositReviewInvalidReason(review, {
      ...exactContext,
      accountNonce: 13,
    }),
    null,
  );

  assert.notEqual(
    depositTransactionInvalidReason(
      {
        version: 1,
        holder: USER,
        token: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.confidentialToken,
        pool: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
        chainId: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
        participantSlotIndex: participant.slotIndex,
        reservationNonce: participant.reservationNonce,
        depositNonce: 3n,
        accountNonce: 12,
        calldata,
        hash: null,
      },
      {
        from: USER,
        to: WRONG_CONTRACT,
        input: calldata,
        nonce: 12,
        value: 0n,
      },
    ),
    null,
  );
});

void test("binds threshold settlement to the exact V2 Pool, participant, handle, proof and wallet nonce", () => {
  const pendingParticipant = {
    slotIndex: participant.slotIndex,
    state: PARTICIPANT_STATE.PENDING_ACTIVATION,
    owner: USER,
    registrationVersion: SUPPORTED_REGISTRATION_VERSION,
    reservationNonce: participant.reservationNonce,
    activationDeadline: 5_000n,
  } as const;

  const calldata = encodeFunctionData({
    abi: VEILPOT_POOL_V2_ABI,
    functionName: "settleThreshold",
    args: [
      pendingParticipant.slotIndex,
      pendingParticipant.registrationVersion,
      pendingParticipant.reservationNonce,
      true,
      PROOF,
    ],
  });

  const review = createThresholdSettlementReview({
    holder: USER,
    pool: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
    chainId: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
    participant: pendingParticipant,
    thresholdHandle: THRESHOLD_HANDLE,
    clearSatisfied: true,
    decryptionProof: PROOF,
    calldata,
    accountNonce: 14,
    preparedAt: 1_000,
    simulatedAt: 1_000,
  });

  const exactContext = {
    holder: USER,
    chainId: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
    participant: pendingParticipant,
    thresholdHandle: THRESHOLD_HANDLE,
    currentCalldata: calldata,
    accountNonce: 14,
    nowSeconds: 1_001,
  } as const;

  assert.equal(thresholdReviewInvalidReason(review, exactContext), null);

  assert.notEqual(
    thresholdReviewInvalidReason(review, {
      ...exactContext,
      thresholdHandle: `0x${"22".repeat(32)}`,
    }),
    null,
  );

  assert.notEqual(
    thresholdSettlementTransactionInvalidReason(
      {
        version: 1,
        holder: USER,
        pool: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
        chainId: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
        participantSlotIndex: pendingParticipant.slotIndex,
        registrationVersion: pendingParticipant.registrationVersion,
        reservationNonce: pendingParticipant.reservationNonce,
        activationDeadline: pendingParticipant.activationDeadline,
        thresholdHandle: THRESHOLD_HANDLE,
        clearSatisfied: true,
        accountNonce: 14,
        calldata,
        hash: null,
      },
      {
        from: USER,
        to: WRONG_CONTRACT,
        input: calldata,
        nonce: 14,
        value: 0n,
      },
    ),
    null,
  );
});
