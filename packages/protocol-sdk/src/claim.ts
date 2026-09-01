import { VEILPOT_SEPOLIA_DEPLOYMENT } from "./deployment.js";
import {
  assertAddress,
  assertHex,
  assertUint256,
  sameAddress,
  type Address,
  type Hex,
} from "./types.js";

export interface ClaimAuthorization {
  readonly chainId: bigint;
  readonly reserve: Address;
  readonly pool: Address;
  readonly drawId: bigint;
  readonly slotIndex: bigint;
  readonly participant: Address;
  readonly recipient: Address;
  readonly registrationVersion: bigint;
  readonly reservationNonce: bigint;
  readonly nonce: bigint;
  readonly expiry: bigint;
}

export interface ClaimAuthorizationInput {
  readonly drawId: bigint;
  readonly slotIndex: bigint;
  readonly owner: Address;
  readonly registrationVersion: bigint;
  readonly reservationNonce: bigint;
  readonly nonce: bigint;
  readonly expiry: bigint;
}

export const CLAIM_AUTHORIZATION_PRIMARY_TYPE = "ClaimAuthorization" as const;

export const CLAIM_AUTHORIZATION_TYPES = {
  ClaimAuthorization: [
    { name: "chainId", type: "uint256" },
    { name: "reserve", type: "address" },
    { name: "pool", type: "address" },
    { name: "drawId", type: "uint256" },
    { name: "slotIndex", type: "uint256" },
    { name: "participant", type: "address" },
    { name: "recipient", type: "address" },
    {
      name: "registrationVersion",
      type: "uint256",
    },
    {
      name: "reservationNonce",
      type: "uint256",
    },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" },
  ],
} as const;

export const CLAIM_EIP712_DOMAIN = {
  name: "VeilpotPrizeReserve",
  version: "1",
  chainId: BigInt(VEILPOT_SEPOLIA_DEPLOYMENT.chainId),
  verifyingContract: VEILPOT_SEPOLIA_DEPLOYMENT.reserve,
} as const;

export function buildClaimAuthorization(input: ClaimAuthorizationInput): ClaimAuthorization {
  assertAddress(input.owner, "claim owner");
  assertUint256(input.drawId, "drawId");
  assertUint256(input.slotIndex, "slotIndex");
  assertUint256(input.registrationVersion, "registrationVersion");
  assertUint256(input.reservationNonce, "reservationNonce");
  assertUint256(input.nonce, "nonce");
  assertUint256(input.expiry, "expiry");

  if (input.expiry === 0n) {
    throw new RangeError("claim expiry must be nonzero");
  }

  return {
    chainId: BigInt(VEILPOT_SEPOLIA_DEPLOYMENT.chainId),
    reserve: VEILPOT_SEPOLIA_DEPLOYMENT.reserve,
    pool: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
    drawId: input.drawId,
    slotIndex: input.slotIndex,
    participant: input.owner,
    recipient: input.owner,
    registrationVersion: input.registrationVersion,
    reservationNonce: input.reservationNonce,
    nonce: input.nonce,
    expiry: input.expiry,
  };
}

export function assertFrozenClaimAuthorization(authorization: ClaimAuthorization): void {
  assertAddress(authorization.reserve, "claim reserve");
  assertAddress(authorization.pool, "claim pool");
  assertAddress(authorization.participant, "claim participant");
  assertAddress(authorization.recipient, "claim recipient");

  assertUint256(authorization.chainId, "chainId");
  assertUint256(authorization.drawId, "drawId");
  assertUint256(authorization.slotIndex, "slotIndex");
  assertUint256(authorization.registrationVersion, "registrationVersion");
  assertUint256(authorization.reservationNonce, "reservationNonce");
  assertUint256(authorization.nonce, "nonce");
  assertUint256(authorization.expiry, "expiry");

  if (
    authorization.chainId !== BigInt(VEILPOT_SEPOLIA_DEPLOYMENT.chainId) ||
    !sameAddress(authorization.reserve, VEILPOT_SEPOLIA_DEPLOYMENT.reserve) ||
    !sameAddress(authorization.pool, VEILPOT_SEPOLIA_DEPLOYMENT.pool) ||
    !sameAddress(authorization.participant, authorization.recipient) ||
    authorization.expiry === 0n
  ) {
    throw new Error("claim authorization violates frozen Veilpot identity");
  }
}

export function buildClaimTypedData(input: ClaimAuthorizationInput) {
  const message = buildClaimAuthorization(input);

  return {
    domain: CLAIM_EIP712_DOMAIN,
    types: CLAIM_AUTHORIZATION_TYPES,
    primaryType: CLAIM_AUTHORIZATION_PRIMARY_TYPE,
    message,
  } as const;
}

export function assertClaimSignature(signature: unknown): asserts signature is Hex {
  assertHex(signature, "claim signature");

  if (signature === "0x") {
    throw new Error("claim signature must not be empty");
  }
}
