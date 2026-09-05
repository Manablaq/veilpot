"use client";

import { CircleCheck, LockKeyhole, RefreshCw, ShieldCheck, WalletCards } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { encodeFunctionData, parseUnits, type Address } from "viem";
import { useMetadata, useZamaSDK } from "@zama-fhe/react-sdk";
import { useConnection, usePublicClient } from "wagmi";

import {
  PARTICIPANT_STATE,
  VEILPOT_POOL_ABI,
  VEILPOT_SEPOLIA_DEPLOYMENT,
  buildWithdrawalCall,
  encryptPoolAmount,
} from "@veilpot/protocol-sdk";

import { ExactActionReviewCard, useExactAction } from "@/components/exact-action-control";

interface ParticipantSnapshot {
  readonly slotIndex: bigint;
  readonly state: number;
  readonly owner: Address;
  readonly registrationVersion: bigint;
  readonly reservationNonce: bigint;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The withdrawal action stopped safely.";
}

function parsePublicBoolean(value: unknown): boolean {
  if (value === true || value === 1 || value === 1n || value === "1" || value === "true") {
    return true;
  }
  if (value === false || value === 0 || value === 0n || value === "0" || value === "false") {
    return false;
  }
  throw new Error("The publicly decrypted deregistration value is not a canonical boolean.");
}

export function WithdrawalPanel({
  authenticatedAddress,
}: {
  readonly authenticatedAddress: Address;
}) {
  const connection = useConnection();
  const publicClient = usePublicClient({ chainId: VEILPOT_SEPOLIA_DEPLOYMENT.chainId });
  const metadataQuery = useMetadata(VEILPOT_SEPOLIA_DEPLOYMENT.confidentialToken);
  const zama = useZamaSDK();
  const exact = useExactAction(authenticatedAddress);

  const [participant, setParticipant] = useState<ParticipantSnapshot | null>(null);
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [encryptedReviewAmount, setEncryptedReviewAmount] = useState<string | null>(null);

  const tokenDecimals = metadataQuery.data?.decimals;
  const tokenSymbol = metadataQuery.data?.symbol ?? "cUSDTMock";

  const parsedAmount = useMemo(() => {
    if (tokenDecimals === undefined || amount.trim().length === 0) return null;
    try {
      const value = parseUnits(amount.trim(), tokenDecimals);
      return value > 0n && value <= (1n << 64n) - 1n ? value : null;
    } catch {
      return null;
    }
  }, [amount, tokenDecimals]);

  const loadParticipant = useCallback(async (): Promise<ParticipantSnapshot | null> => {
    if (publicClient === undefined) return null;

    const maximum = await publicClient.readContract({
      address: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
      abi: VEILPOT_POOL_ABI,
      functionName: "MAX_PARTICIPANTS",
    });

    for (let index = 0; index < Number(maximum); index += 1) {
      const stateValue = await publicClient.readContract({
        address: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
        abi: VEILPOT_POOL_ABI,
        functionName: "participantState",
        args: [BigInt(index)],
      });
      if (stateValue === PARTICIPANT_STATE.FREE || stateValue === PARTICIPANT_STATE.TOMBSTONED) {
        continue;
      }

      const row = await publicClient.readContract({
        address: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
        abi: VEILPOT_POOL_ABI,
        functionName: "participantMetadata",
        args: [BigInt(index)],
      });

      if (row[1].toLowerCase() === authenticatedAddress.toLowerCase()) {
        return {
          slotIndex: BigInt(index),
          state: row[0],
          owner: row[1],
          registrationVersion: row[2],
          reservationNonce: row[3],
        };
      }
    }

    return null;
  }, [authenticatedAddress, publicClient]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setNotice(null);
    try {
      setParticipant(await loadParticipant());
    } catch (error: unknown) {
      setNotice(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [loadParticipant]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (exact.status.kind === "included" || exact.status.kind === "reverted") {
      setEncryptedReviewAmount(null);
      void refresh();
    }
  }, [exact.status, refresh]);

  const prepareWithdrawal = useCallback(async () => {
    setNotice(null);
    setEncryptedReviewAmount(null);
    exact.discardReview();

    if (
      parsedAmount === null ||
      publicClient === undefined ||
      connection.status !== "connected" ||
      connection.address.toLowerCase() !== authenticatedAddress.toLowerCase() ||
      connection.chainId !== VEILPOT_SEPOLIA_DEPLOYMENT.chainId
    ) {
      setNotice(
        "Connect the authenticated wallet on Ethereum Sepolia and enter a positive amount.",
      );
      return;
    }

    setLoading(true);
    try {
      const before = await loadParticipant();
      if (
        before?.state !== PARTICIPANT_STATE.ACTIVE ||
        before.owner.toLowerCase() !== connection.address.toLowerCase()
      ) {
        throw new Error("The authenticated participant is not ACTIVE.");
      }

      const withdrawalNonce = await publicClient.readContract({
        address: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
        abi: VEILPOT_POOL_ABI,
        functionName: "nextWithdrawNonce",
        args: [connection.address],
      });

      const encrypted = await encryptPoolAmount(zama, parsedAmount, connection.address);

      const [after, withdrawalNonceAfter] = await Promise.all([
        loadParticipant(),
        publicClient.readContract({
          address: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
          abi: VEILPOT_POOL_ABI,
          functionName: "nextWithdrawNonce",
          args: [connection.address],
        }),
      ]);

      if (
        after?.state !== PARTICIPANT_STATE.ACTIVE ||
        after.owner.toLowerCase() !== before.owner.toLowerCase() ||
        after.slotIndex !== before.slotIndex ||
        after.registrationVersion !== before.registrationVersion ||
        after.reservationNonce !== before.reservationNonce ||
        withdrawalNonceAfter !== withdrawalNonce
      ) {
        throw new Error(
          "Participant or withdrawal nonce changed during encryption. The encrypted review was discarded.",
        );
      }

      const descriptor = buildWithdrawalCall({
        encrypted,
        caller: connection.address,
        registrationVersion: after.registrationVersion,
        reservationNonce: after.reservationNonce,
        withdrawalNonce,
      });

      const data = encodeFunctionData({
        abi: descriptor.abi,
        functionName: descriptor.functionName,
        args: descriptor.args,
      });

      const prepared = await exact.prepare({
        key: `confidential-withdrawal:${withdrawalNonce.toString()}`,
        label: "Confidential principal withdrawal",
        consequence:
          "Withdraw up to the encrypted requested amount, capped by the participant's encrypted principal. The actual principal is not decrypted.",
        to: descriptor.address,
        data,
        value: 0n,
      });

      if (prepared !== null) {
        setEncryptedReviewAmount(amount.trim());
        setNotice(
          `Encrypted exactly the entered ${amount.trim()} ${tokenSymbol} request for review. No private principal was decrypted.`,
        );
      }
    } catch (error: unknown) {
      setNotice(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [
    amount,
    authenticatedAddress,
    connection,
    exact,
    loadParticipant,
    parsedAmount,
    publicClient,
    tokenSymbol,
    zama,
  ]);

  const prepareDeregistrationPredicate = useCallback(async () => {
    if (participant?.state !== PARTICIPANT_STATE.ACTIVE || publicClient === undefined) {
      setNotice("Deregistration preparation requires an ACTIVE participant.");
      return;
    }

    const data = encodeFunctionData({
      abi: VEILPOT_POOL_ABI,
      functionName: "prepareDeregistration",
      args: [participant.slotIndex],
    });

    await exact.prepare({
      key: `prepare-deregistration:${participant.slotIndex.toString()}`,
      label: "Prepare zero-principal deregistration predicate",
      consequence:
        "Create a publicly decryptable boolean proving whether encrypted principal is exactly zero. This transaction does not reveal principal.",
      to: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
      data,
      value: 0n,
    });
  }, [exact, participant, publicClient]);

  const decryptDeregistrationPredicate = useCallback(async () => {
    if (participant?.state !== PARTICIPANT_STATE.ACTIVE || publicClient === undefined) {
      setNotice("The participant must remain ACTIVE for this proof.");
      return;
    }

    setLoading(true);
    setNotice(
      "Decrypting only the public zero-principal predicate. The confidential principal itself is not being decrypted.",
    );

    try {
      const handle = await publicClient.readContract({
        address: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
        abi: VEILPOT_POOL_ABI,
        functionName: "deregistrationZeroHandle",
        args: [participant.slotIndex],
      });

      const result = await zama.decryption.decryptPublicValues([handle], {
        timeout: 180_000,
      });
      const entry = Object.entries(result.clearValues).find(
        ([key]) => key.toLowerCase() === handle.toLowerCase(),
      );
      if (entry === undefined) {
        throw new Error("The public proof did not contain the exact deregistration handle.");
      }

      const clearZero = parsePublicBoolean(entry[1]);
      if (!clearZero) {
        setNotice(
          "Zero-principal predicate: FALSE. The participant remains ACTIVE; no deregistration settlement was prepared.",
        );
        return;
      }

      const proof = result.decryptionProof;
      const data = encodeFunctionData({
        abi: VEILPOT_POOL_ABI,
        functionName: "settleDeregistration",
        args: [participant.slotIndex, true, proof],
      });

      await exact.prepare({
        key: `settle-deregistration:${participant.slotIndex.toString()}`,
        label: "Settle TRUE zero-principal deregistration proof",
        consequence:
          "Tombstone the participant slot only after the KMS proof verifies encrypted principal is exactly zero.",
        to: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
        data,
        value: 0n,
      });

      setNotice(
        "Zero-principal predicate: TRUE. Exact deregistration settlement simulated; wallet signing remains separate.",
      );
    } catch (error: unknown) {
      setNotice(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [exact, participant, publicClient, zama.decryption]);

  return (
    <div className="financial-form">
      {participant?.state === PARTICIPANT_STATE.ACTIVE ? (
        <>
          <div className="financial-step-card complete">
            <span className="financial-step-icon">
              <CircleCheck size={18} />
            </span>
            <div>
              <strong>ACTIVE participant verified from Sepolia</strong>
              <p>
                Slot {participant.slotIndex.toString()} · registration version{" "}
                {participant.registrationVersion.toString()} · reservation nonce{" "}
                {participant.reservationNonce.toString()}
              </p>
            </div>
          </div>

          <label>
            <span>Requested withdrawal amount</span>
            <div className="financial-input-unit">
              <input
                inputMode="decimal"
                value={amount}
                placeholder="1.00"
                onChange={(event) => {
                  setAmount(event.target.value);
                  setEncryptedReviewAmount(null);
                  exact.discardReview();
                }}
              />
              <small>{tokenSymbol}</small>
            </div>
            <small className="financial-field-help">
              The amount is encrypted only after the explicit preparation click. The Pool caps the
              encrypted request at encrypted principal; Veilpot never decrypts principal
              automatically.
            </small>
          </label>

          <button
            className="financial-primary-button"
            type="button"
            disabled={
              parsedAmount === null || loading || exact.attempt !== null || exact.isWalletPending
            }
            onClick={() => {
              void prepareWithdrawal();
            }}
          >
            <LockKeyhole size={15} /> Encrypt & prepare exact withdrawal review
          </button>

          {encryptedReviewAmount !== null ? (
            <div className="financial-state-card">
              <ShieldCheck size={18} />
              <div>
                <strong>Encrypted withdrawal review prepared</strong>
                <p>
                  Entered amount: {encryptedReviewAmount} {tokenSymbol}. This clear amount is shown
                  only in the current browser review and is not persisted in the retry record.
                </p>
              </div>
            </div>
          ) : null}

          <ExactActionReviewCard controller={exact} />

          <div className="action-safety-note">
            <ShieldCheck size={17} />
            <p>
              <strong>Optional full exit.</strong> After withdrawals, zero-principal deregistration
              is a separate proof flow. Preparing it does not reveal principal, and public boolean
              decryption remains an explicit user action.
            </p>
          </div>

          <button
            className="financial-secondary-button"
            type="button"
            disabled={loading || exact.attempt !== null}
            onClick={() => {
              void prepareDeregistrationPredicate();
            }}
          >
            <WalletCards size={15} /> Prepare zero-principal predicate
          </button>

          <button
            className="financial-secondary-button"
            type="button"
            disabled={loading || exact.attempt !== null || exact.review !== null}
            onClick={() => {
              void decryptDeregistrationPredicate();
            }}
          >
            <LockKeyhole size={15} /> Decrypt zero-principal boolean explicitly
          </button>
        </>
      ) : (
        <div className="financial-state-card warning">
          <ShieldCheck size={20} />
          <div>
            <strong>Withdrawal requires an ACTIVE participant</strong>
            <p>{loading ? "Checking live Pool state…" : "The current wallet is not ACTIVE."}</p>
          </div>
        </div>
      )}

      {notice !== null ? <p className="financial-field-help">{notice}</p> : null}

      <button
        className="financial-secondary-button"
        type="button"
        disabled={loading}
        onClick={() => {
          void refresh();
        }}
      >
        <RefreshCw size={15} /> Refresh participant state
      </button>
    </div>
  );
}
