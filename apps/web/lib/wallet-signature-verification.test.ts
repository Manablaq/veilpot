import assert from "node:assert/strict";
import test from "node:test";

import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { verifyVeilpotWalletSignature } from "./wallet-signature-verification";

void test("valid EOA signatures verify locally without touching Sepolia RPC fallback", async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const message = "Veilpot local EOA verification test";
  const signature = await account.signMessage({ message });
  let fallbackCalls = 0;

  const valid = await verifyVeilpotWalletSignature(
    { address: account.address, message, signature },
    () => {
      fallbackCalls += 1;
      return Promise.resolve(false);
    },
  );

  assert.equal(valid, true);
  assert.equal(fallbackCalls, 0);
});

void test("non-matching signatures fall through to the smart-account verifier", async () => {
  const signer = privateKeyToAccount(generatePrivateKey());
  const other = privateKeyToAccount(generatePrivateKey());
  const message = "Veilpot smart-account fallback test";
  const signature = await signer.signMessage({ message });
  let fallbackCalls = 0;

  const valid = await verifyVeilpotWalletSignature(
    { address: other.address, message, signature },
    () => {
      fallbackCalls += 1;
      return Promise.resolve(true);
    },
  );

  assert.equal(valid, true);
  assert.equal(fallbackCalls, 1);
});

void test("smart-account verifier failures fail closed", async () => {
  const signer = privateKeyToAccount(generatePrivateKey());
  const other = privateKeyToAccount(generatePrivateKey());
  const message = "Veilpot fail-closed verification test";
  const signature = await signer.signMessage({ message });

  const valid = await verifyVeilpotWalletSignature(
    { address: other.address, message, signature },
    () => Promise.reject(new Error("simulated RPC outage")),
  );

  assert.equal(valid, false);
});
