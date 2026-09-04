import { getAddress, isAddress, type Address } from "viem";

export const VEILPOT_CHAIN_ID = 11155111;
export const VEILPOT_SIWE_STATEMENT =
  "Sign in to Veilpot. This does not move funds or reveal private values.";
export const VEILPOT_SESSION_TTL_MS = 4 * 60 * 60 * 1000;

export interface VeilpotSiweFields {
  readonly domain: string;
  readonly address: Address;
  readonly uri: string;
  readonly chainId: number;
  readonly nonce: string;
  readonly issuedAt: string;
  readonly expirationTime: string;
}

export function buildVeilpotSiweMessage(fields: VeilpotSiweFields): string {
  return `${fields.domain} wants you to sign in with your Ethereum account:\n${fields.address}\n\n${VEILPOT_SIWE_STATEMENT}\n\nURI: ${fields.uri}\nVersion: 1\nChain ID: ${String(fields.chainId)}\nNonce: ${fields.nonce}\nIssued At: ${fields.issuedAt}\nExpiration Time: ${fields.expirationTime}`;
}

const messagePattern =
  /^([^\n]+) wants you to sign in with your Ethereum account:\n(0x[0-9a-fA-F]{40})\n\n([^\n]*)\n\nURI: ([^\n]+)\nVersion: 1\nChain ID: ([0-9]+)\nNonce: ([A-Za-z0-9]+)\nIssued At: ([^\n]+)\nExpiration Time: ([^\n]+)$/;

export function parseVeilpotSiweMessage(message: string): VeilpotSiweFields {
  const match = messagePattern.exec(message);
  if (!match) throw new Error("Malformed SIWE message.");

  const [, domain, rawAddress, statement, uri, rawChainId, nonce, issuedAt, expirationTime] = match;

  if (statement !== VEILPOT_SIWE_STATEMENT) throw new Error("Unexpected SIWE statement.");
  if (!isAddress(rawAddress)) throw new Error("Invalid SIWE address.");
  if (!/^[A-Za-z0-9]{8,128}$/.test(nonce)) throw new Error("Invalid SIWE nonce.");

  const chainId = Number(rawChainId);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error("Invalid SIWE chain ID.");

  const issuedMs = Date.parse(issuedAt);
  const expiresMs = Date.parse(expirationTime);
  if (!Number.isFinite(issuedMs) || !Number.isFinite(expiresMs))
    throw new Error("Invalid SIWE timestamps.");

  return {
    domain,
    address: getAddress(rawAddress),
    uri,
    chainId,
    nonce,
    issuedAt,
    expirationTime,
  };
}
