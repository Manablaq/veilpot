"use client";

import {
  CircleCheck,
  CircleDashed,
  Gift,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  Signature,
  WalletCards,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { encodeFunctionData, formatUnits, type Address, type Hex } from "viem";
import { useMetadata, useZamaSDK } from "@zama-fhe/react-sdk";
import { useConnection, usePublicClient, useSignTypedData } from "wagmi";

import {
  PARTICIPANT_STATE,
  VEILPOT_POOL_ABI,
  VEILPOT_RESERVE_ABI,
  VEILPOT_SEPOLIA_DEPLOYMENT,
  buildAuthorizeEntitlementDecryptionCall,
  buildClaimAuthorization,
  buildClaimPrizeCall,
  buildClaimTypedData,
  type ClaimAuthorization,
} from "@veilpot/protocol-sdk";

import { ExactActionReviewCard, useExactAction } from "@/components/exact-action-control";

const PRIZE_STATE_NAME: Readonly<Record<number, string>> = {
  0: "UNPREPARED",
  1: "STATUS_PROOF_PENDING",
  2: "ASSIGNING",
  3: "CLAIMABLE",
  4: "CLAIMED",
  5: "NO_PRIZE",
  6: "TRANSFER_PROOF_PENDING",
};

interface PrizeSnapshot {
  readonly state: number;
  readonly statusPredicate: Hex;
  readonly proofContext: Hex;
  readonly participantCount: bigint;
  readonly assignmentCursor: bigint;
  readonly statusAttemptNonce: bigint;
  readonly statusProofDeadline: bigint;
}

interface EntitlementSnapshot {
  readonly initialized: boolean;
  readonly beneficiaryBound: boolean;
  readonly owner: Address;
  readonly registrationVersion: bigint;
  readonly reservationNonce: bigint;
  readonly amount: Hex;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : "The PrizeReserve action stopped safely.";
}

function parsePublicBoolean(value: unknown): boolean {
  if (value === true || value === 1 || value === 1n || value === "1" || value === "true") {
    return true;
  }
  if (value === false || value === 0 || value === 0n || value === "0" || value === "false") {
    return false;
  }
  throw new Error("The public prize proof did not return a canonical boolean.");
}

function parsePublicBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  if (typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value)) {
    return BigInt(value);
  }
  throw new Error("The public proof context is not a canonical unsigned integer.");
}

function readClear(values: Readonly<Record<string, unknown>>, handle: Hex): unknown {
  const entry = Object.entries(values).find(([key]) => key.toLowerCase() === handle.toLowerCase());
  if (entry === undefined) {
    throw new Error("Decryption result did not contain the exact requested handle.");
  }
  return entry[1];
}

function timeLabel(value: bigint): string {
  return value === 0n ? "—" : new Date(Number(value) * 1000).toLocaleString();
}

export function PrizeControlCenter({
  authenticatedAddress,
}: {
  readonly authenticatedAddress: Address;
}) {
  const connection = useConnection();
  const publicClient = usePublicClient({ chainId: VEILPOT_SEPOLIA_DEPLOYMENT.chainId });
  const metadata = useMetadata(VEILPOT_SEPOLIA_DEPLOYMENT.confidentialToken);
  const zama = useZamaSDK();
  const signTypedData = useSignTypedData();
  const exact = useExactAction(authenticatedAddress);

  const [drawIdText, setDrawIdText] = useState("");
  const [slotText, setSlotText] = useState("");
  const [latestDrawId, setLatestDrawId] = useState<bigint>(0n);
  const [prize, setPrize] = useState<PrizeSnapshot | null>(null);
  const [entitlement, setEntitlement] = useState<EntitlementSnapshot | null>(null);
  const [privateEntitlement, setPrivateEntitlement] = useState<bigint | null>(null);
  const [claimAuthorization, setClaimAuthorization] = useState<ClaimAuthorization | null>(null);
  const [claimSignature, setClaimSignature] = useState<Hex | null>(null);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [publicEvidence, setPublicEvidence] = useState<string | null>(null);

  const tokenDecimals = metadata.data?.decimals;
  const tokenSymbol = metadata.data?.symbol ?? "cUSDTMock";

  const selectedDrawId = useMemo(() => {
    if (!/^[1-9][0-9]*$/.test(drawIdText)) return null;
    return BigInt(drawIdText);
  }, [drawIdText]);

  const selectedSlot = useMemo(() => {
    if (!/^(?:0|[1-9][0-9]*)$/.test(slotText)) return null;
    return BigInt(slotText);
  }, [slotText]);

  const findCurrentSlot = useCallback(async (): Promise<bigint | null> => {
    if (publicClient === undefined) return null;
    const maximum = await publicClient.readContract({
      address: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
      abi: VEILPOT_POOL_ABI,
      functionName: "MAX_PARTICIPANTS",
    });

    for (let index = 0; index < Number(maximum); index += 1) {
      const state = await publicClient.readContract({
        address: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
        abi: VEILPOT_POOL_ABI,
        functionName: "participantState",
        args: [BigInt(index)],
      });
      if (state === PARTICIPANT_STATE.FREE || state === PARTICIPANT_STATE.TOMBSTONED) {
        continue;
      }
      const row = await publicClient.readContract({
        address: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
        abi: VEILPOT_POOL_ABI,
        functionName: "participantMetadata",
        args: [BigInt(index)],
      });
      if (row[1].toLowerCase() === authenticatedAddress.toLowerCase()) {
        return BigInt(index);
      }
    }
    return null;
  }, [authenticatedAddress, publicClient]);

  const loadEntitlement = useCallback(
    async (drawId: bigint, slotIndex: bigint) => {
      if (publicClient === undefined) return;
      try {
        const row = await publicClient.readContract({
          address: VEILPOT_SEPOLIA_DEPLOYMENT.reserve,
          abi: VEILPOT_RESERVE_ABI,
          functionName: "prizeEntitlementRecord",
          args: [drawId, slotIndex],
        });
        setEntitlement({
          initialized: row[0],
          beneficiaryBound: row[1],
          owner: row[2],
          registrationVersion: row[3],
          reservationNonce: row[4],
          amount: row[5],
        });
      } catch {
        setEntitlement(null);
      }
    },
    [publicClient],
  );

  const refresh = useCallback(async () => {
    if (publicClient === undefined) return;

    setLoading(true);
    setNotice(null);
    try {
      const nextDrawId = await publicClient.readContract({
        address: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
        abi: VEILPOT_POOL_ABI,
        functionName: "nextDrawId",
      });
      setLatestDrawId(nextDrawId);

      let drawId = selectedDrawId;
      if (drawId === null && nextDrawId > 0n) {
        drawId = nextDrawId;
        setDrawIdText(nextDrawId.toString());
      }

      if (slotText.length === 0) {
        const currentSlot = await findCurrentSlot();
        if (currentSlot !== null) setSlotText(currentSlot.toString());
      }

      if (drawId === null || drawId === 0n) {
        setPrize(null);
        setEntitlement(null);
        return;
      }

      try {
        const row = await publicClient.readContract({
          address: VEILPOT_SEPOLIA_DEPLOYMENT.reserve,
          abi: VEILPOT_RESERVE_ABI,
          functionName: "prizeHandles",
          args: [drawId],
        });

        setPrize({
          state: row[0],
          statusPredicate: row[4],
          proofContext: row[5],
          participantCount: row[6],
          assignmentCursor: row[7],
          statusAttemptNonce: row[8],
          statusProofDeadline: row[9],
        });

        const slot = selectedSlot ?? (slotText.length === 0 ? await findCurrentSlot() : null);
        if (slot !== null) {
          await loadEntitlement(drawId, slot);
        }
      } catch {
        setPrize(null);
        setEntitlement(null);
      }
    } catch (error: unknown) {
      setNotice(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [findCurrentSlot, loadEntitlement, publicClient, selectedDrawId, selectedSlot, slotText]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (exact.status.kind === "included" || exact.status.kind === "reverted") {
      setClaimSignature(null);
      void refresh();
    }
  }, [exact.status, refresh]);

  useEffect(() => {
    setPrivateEntitlement(null);
    setClaimAuthorization(null);
    setClaimSignature(null);
  }, [entitlement?.amount, prize?.state]);

  const stageReserveAction = useCallback(
    async (
      key: string,
      label: string,
      consequence: string,
      functionName:
        | "preparePrize"
        | "settlePrizeStatus"
        | "assignPrizeEntitlementChunk"
        | "authorizeEntitlementDecryption"
        | "claimPrize"
        | "settleClaimCompletion"
        | "refreshClaimCompletionEvidence"
        | "refreshPrizeStatusEvidence",
      args: readonly unknown[],
    ) => {
      const data = encodeFunctionData({
        abi: VEILPOT_RESERVE_ABI,
        functionName,
        args: args as never,
      });
      await exact.prepare({
        key,
        label,
        consequence,
        to: VEILPOT_SEPOLIA_DEPLOYMENT.reserve,
        data,
        value: 0n,
      });
    },
    [exact],
  );

  const preparePrize = useCallback(async () => {
    if (selectedDrawId === null) return;
    await stageReserveAction(
      `prize:prepare:${selectedDrawId.toString()}`,
      "Prepare frozen prize liability",
      "Freeze realized yield and explicit sponsor funding for this finalized draw into an encrypted prize liability and publish only its zero/nonzero status predicate.",
      "preparePrize",
      [selectedDrawId],
    );
  }, [selectedDrawId, stageReserveAction]);

  const decryptPrizeStatus = useCallback(async () => {
    if (selectedDrawId === null || prize?.state !== 1 || publicClient === undefined) {
      setNotice("Prize-status evidence is only available in STATUS_PROOF_PENDING.");
      return;
    }

    setLoading(true);
    setNotice(
      "Decrypting only the publicly authorized zero-prize predicate and proof context. Prize amount remains encrypted.",
    );
    try {
      const result = await zama.decryption.decryptPublicValues(
        [prize.statusPredicate, prize.proofContext],
        { timeout: 180_000 },
      );

      const zeroPrize = parsePublicBoolean(readClear(result.clearValues, prize.statusPredicate));
      const context = parsePublicBigInt(readClear(result.clearValues, prize.proofContext));
      const proof = result.decryptionProof;

      await stageReserveAction(
        `prize:settle-status:${selectedDrawId.toString()}:${prize.statusAttemptNonce.toString()}`,
        "Settle exact public prize-status proof",
        zeroPrize
          ? "Verify the prize is exactly zero and move this draw to NO_PRIZE."
          : "Verify the frozen prize is nonzero and enter fixed historical entitlement assignment.",
        "settlePrizeStatus",
        [selectedDrawId, prize.statusAttemptNonce, zeroPrize, proof],
      );

      setPublicEvidence(
        `Prize status: zeroPrize=${String(zeroPrize)}, proofContext=${context.toString()}. Prize amount remains encrypted.`,
      );
    } catch (error: unknown) {
      setNotice(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [prize, publicClient, selectedDrawId, stageReserveAction, zama.decryption]);

  const assignNextChunk = useCallback(async () => {
    if (selectedDrawId === null || prize?.state !== 2) return;
    await stageReserveAction(
      `prize:assign:${selectedDrawId.toString()}:${prize.assignmentCursor.toString()}`,
      "Assign next fixed historical prize-entitlement chunk",
      "Persist encrypted entitlements for the next fixed historical snapshot slots without revealing winner predicates or prize amounts.",
      "assignPrizeEntitlementChunk",
      [selectedDrawId, prize.assignmentCursor],
    );
  }, [prize, selectedDrawId, stageReserveAction]);

  const authorizeEntitlement = useCallback(async () => {
    if (selectedDrawId === null || selectedSlot === null || entitlement === null) return;
    if (
      !entitlement.initialized ||
      !entitlement.beneficiaryBound ||
      entitlement.owner.toLowerCase() !== authenticatedAddress.toLowerCase()
    ) {
      setNotice("This slot is not an initialized entitlement owned by the authenticated wallet.");
      return;
    }

    const descriptor = buildAuthorizeEntitlementDecryptionCall(selectedDrawId, selectedSlot);
    const data = encodeFunctionData({
      abi: descriptor.abi,
      functionName: descriptor.functionName,
      args: descriptor.args,
    });

    await exact.prepare({
      key: `prize:authorize-decrypt:${selectedDrawId.toString()}:${selectedSlot.toString()}`,
      label: "Authorize private entitlement decryption",
      consequence:
        "Grant the frozen historical beneficiary persistent ACL access to this current encrypted entitlement handle. No decryption occurs in this transaction.",
      to: descriptor.address,
      data,
      value: 0n,
    });
  }, [authenticatedAddress, entitlement, exact, selectedDrawId, selectedSlot]);

  const revealEntitlement = useCallback(async () => {
    if (
      entitlement === null ||
      selectedDrawId === null ||
      selectedSlot === null ||
      entitlement.owner.toLowerCase() !== authenticatedAddress.toLowerCase()
    ) {
      setNotice("Select an entitlement owned by the authenticated wallet.");
      return;
    }

    if (
      connection.status !== "connected" ||
      connection.address.toLowerCase() !== authenticatedAddress.toLowerCase() ||
      connection.chainId !== VEILPOT_SEPOLIA_DEPLOYMENT.chainId
    ) {
      setNotice(
        "Connect the exact authenticated wallet on Ethereum Sepolia before requesting private entitlement decryption.",
      );
      return;
    }

    setLoading(true);
    setNotice(
      "Requesting private decryption of only this authorized historical entitlement. A wallet permit signature may be requested by the Zama SDK.",
    );
    try {
      const result = await zama.decryption.decryptValues([
        {
          encryptedValue: entitlement.amount,
          contractAddress: VEILPOT_SEPOLIA_DEPLOYMENT.reserve,
        },
      ]);

      const clear = result[entitlement.amount];
      if (clear === undefined) {
        throw new Error("Private decryption did not return the exact entitlement handle.");
      }
      setPrivateEntitlement(BigInt(clear));
      setNotice(
        "Private entitlement revealed only to this authorized wallet session. It was not made public on-chain.",
      );
    } catch (error: unknown) {
      setPrivateEntitlement(null);
      setNotice(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [
    authenticatedAddress,
    connection,
    entitlement,
    selectedDrawId,
    selectedSlot,
    zama.decryption,
  ]);

  const prepareClaimAuthorization = useCallback(async () => {
    if (
      selectedDrawId === null ||
      selectedSlot === null ||
      entitlement === null ||
      publicClient === undefined ||
      entitlement.owner.toLowerCase() !== authenticatedAddress.toLowerCase()
    ) {
      setNotice("A bound historical entitlement owned by this wallet is required.");
      return;
    }

    try {
      const nonce = await publicClient.readContract({
        address: VEILPOT_SEPOLIA_DEPLOYMENT.reserve,
        abi: VEILPOT_RESERVE_ABI,
        functionName: "nextClaimNonce",
        args: [authenticatedAddress],
      });
      const expiry = BigInt(Math.floor(Date.now() / 1000) + 3_600);
      setClaimAuthorization(
        buildClaimAuthorization({
          drawId: selectedDrawId,
          slotIndex: selectedSlot,
          owner: authenticatedAddress,
          registrationVersion: entitlement.registrationVersion,
          reservationNonce: entitlement.reservationNonce,
          nonce,
          expiry,
        }),
      );
      setClaimSignature(null);
      setNotice(
        "Exact one-hour historical claim authorization prepared. Recipient is frozen to the historical owner.",
      );
    } catch (error: unknown) {
      setNotice(errorMessage(error));
    }
  }, [authenticatedAddress, entitlement, publicClient, selectedDrawId, selectedSlot]);

  const signClaimAuthorization = useCallback(async () => {
    if (claimAuthorization === null) return;

    if (
      connection.status !== "connected" ||
      connection.address.toLowerCase() !== authenticatedAddress.toLowerCase() ||
      connection.chainId !== VEILPOT_SEPOLIA_DEPLOYMENT.chainId
    ) {
      setNotice(
        "Connect the exact authenticated historical-owner wallet on Ethereum Sepolia before signing this claim authorization.",
      );
      return;
    }

    try {
      const signature = await signTypedData.mutateAsync(
        buildClaimTypedData({
          drawId: claimAuthorization.drawId,
          slotIndex: claimAuthorization.slotIndex,
          owner: claimAuthorization.participant,
          registrationVersion: claimAuthorization.registrationVersion,
          reservationNonce: claimAuthorization.reservationNonce,
          nonce: claimAuthorization.nonce,
          expiry: claimAuthorization.expiry,
        }),
      );
      setClaimSignature(signature);
      setNotice(
        "Exact EIP-712 claim authorization signed. No prize transaction was submitted yet.",
      );
    } catch (error: unknown) {
      setClaimSignature(null);
      setNotice(errorMessage(error));
    }
  }, [authenticatedAddress, claimAuthorization, connection, signTypedData]);

  const prepareClaimTransaction = useCallback(async () => {
    if (claimAuthorization === null || claimSignature === null) return;

    try {
      const descriptor = buildClaimPrizeCall(claimAuthorization, claimSignature);
      const data = encodeFunctionData({
        abi: descriptor.abi,
        functionName: descriptor.functionName,
        args: descriptor.args,
      });
      await exact.prepare({
        key: `prize:claim:${claimAuthorization.drawId.toString()}:${claimAuthorization.nonce.toString()}`,
        label: "Claim exact historical prize entitlement",
        consequence:
          "Transfer only the encrypted entitlement bound to this historical owner and start proof-backed claim-completion evidence.",
        to: descriptor.address,
        data,
        value: 0n,
      });
    } catch (error: unknown) {
      setNotice(errorMessage(error));
    }
  }, [claimAuthorization, claimSignature, exact]);

  const decryptClaimCompletion = useCallback(async () => {
    if (selectedDrawId === null || publicClient === undefined) return;

    setLoading(true);
    setNotice(
      "Decrypting only the publicly authorized claim-completion predicate and proof context. No prize amount is decrypted.",
    );

    try {
      const row = await publicClient.readContract({
        address: VEILPOT_SEPOLIA_DEPLOYMENT.reserve,
        abi: VEILPOT_RESERVE_ABI,
        functionName: "claimCompletionHandles",
        args: [selectedDrawId],
      });

      const state = row[0];
      const attemptNonce = row[4];
      const deadline = row[5];
      const predicate = row[6];
      const contextHandle = row[7];

      if (state !== 6) {
        throw new Error("Prize is not in TRANSFER_PROOF_PENDING.");
      }
      if (BigInt(Math.floor(Date.now() / 1000)) > deadline) {
        throw new Error("Claim-completion proof has expired. Refresh evidence first.");
      }

      const result = await zama.decryption.decryptPublicValues([predicate, contextHandle], {
        timeout: 180_000,
      });
      const complete = parsePublicBoolean(readClear(result.clearValues, predicate));
      const context = parsePublicBigInt(readClear(result.clearValues, contextHandle));

      await stageReserveAction(
        `prize:settle-claim-completion:${selectedDrawId.toString()}:${attemptNonce.toString()}`,
        "Settle exact public claim-completion proof",
        complete
          ? "Verify the draw-global encrypted residual is zero and mark the prize CLAIMED."
          : "Verify residual liability remains and return the prize to CLAIMABLE.",
        "settleClaimCompletion",
        [selectedDrawId, attemptNonce, complete, result.decryptionProof],
      );

      setPublicEvidence(
        `Claim completion: complete=${String(complete)}, proofContext=${context.toString()}.`,
      );
    } catch (error: unknown) {
      setNotice(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [publicClient, selectedDrawId, stageReserveAction, zama.decryption]);

  const refreshClaimCompletionEvidence = useCallback(async () => {
    if (selectedDrawId === null) return;
    await stageReserveAction(
      `prize:refresh-claim-completion:${selectedDrawId.toString()}`,
      "Refresh expired claim-completion evidence",
      "Publish a fresh public completion predicate and context after the prior inclusive proof deadline has expired.",
      "refreshClaimCompletionEvidence",
      [selectedDrawId],
    );
  }, [selectedDrawId, stageReserveAction]);

  const refreshPrizeStatusEvidence = useCallback(async () => {
    if (selectedDrawId === null) return;
    await stageReserveAction(
      `prize:refresh-status:${selectedDrawId.toString()}`,
      "Refresh expired prize-status evidence",
      "Publish a fresh zero-prize predicate and context without reopening frozen prize funding.",
      "refreshPrizeStatusEvidence",
      [selectedDrawId],
    );
  }, [selectedDrawId, stageReserveAction]);

  return (
    <section className="workspace-stack">
      <article className="workspace-card block">
        <Gift size={20} />
        <span className="eyebrow">LIVE PRIZE RESERVE</span>
        <h2>Historical entitlements, private claims.</h2>
        <p>
          Prize funding and entitlement amounts remain encrypted. Public proof buttons decrypt only
          contract-authorized consequence predicates and proof contexts. Private entitlement reveal
          is a separate historical-owner action.
        </p>

        <div className="financial-form-grid">
          <label>
            <span>Draw ID</span>
            <input
              inputMode="numeric"
              value={drawIdText}
              placeholder={latestDrawId > 0n ? latestDrawId.toString() : "1"}
              onChange={(event) => {
                setDrawIdText(event.target.value);
                setPrize(null);
                setEntitlement(null);
                setPrivateEntitlement(null);
                setClaimAuthorization(null);
                setClaimSignature(null);
                exact.discardReview();
              }}
            />
          </label>
          <label>
            <span>Historical slot</span>
            <input
              inputMode="numeric"
              value={slotText}
              placeholder="1"
              onChange={(event) => {
                setSlotText(event.target.value);
                setEntitlement(null);
                setPrivateEntitlement(null);
                setClaimAuthorization(null);
                setClaimSignature(null);
                exact.discardReview();
              }}
            />
          </label>
        </div>

        <button
          className="financial-secondary-button"
          type="button"
          disabled={loading}
          onClick={() => {
            void refresh();
          }}
        >
          <RefreshCw size={15} /> Refresh PrizeReserve state
        </button>

        <div className="financial-live-status">
          <div>
            <span>Latest draw</span>
            <strong>{latestDrawId.toString()}</strong>
          </div>
          <div>
            <span>Prize state</span>
            <strong>
              {prize === null ? "UNPREPARED / unavailable" : PRIZE_STATE_NAME[prize.state]}
            </strong>
          </div>
          <div>
            <span>Assignment</span>
            <strong>
              {prize === null
                ? "—"
                : `${prize.assignmentCursor.toString()}/${prize.participantCount.toString()}`}
            </strong>
          </div>
          <div>
            <span>Status proof deadline</span>
            <strong>{prize === null ? "—" : timeLabel(prize.statusProofDeadline)}</strong>
          </div>
        </div>
      </article>

      {selectedDrawId !== null ? (
        <article className="workspace-card block">
          <span className="eyebrow">PRIZE LIFECYCLE</span>
          <div className="workspace-inline-actions">
            {prize === null ? (
              <button
                className="financial-primary-button"
                type="button"
                disabled={exact.attempt !== null}
                onClick={() => {
                  void preparePrize();
                }}
              >
                Prepare frozen prize
              </button>
            ) : null}

            {prize?.state === 1 ? (
              <>
                <button
                  className="financial-secondary-button"
                  type="button"
                  disabled={loading || exact.review !== null || exact.attempt !== null}
                  onClick={() => {
                    void decryptPrizeStatus();
                  }}
                >
                  <LockKeyhole size={15} /> Decrypt public prize-status evidence explicitly
                </button>
                <button
                  className="financial-secondary-button"
                  type="button"
                  disabled={BigInt(Math.floor(Date.now() / 1000)) <= prize.statusProofDeadline}
                  onClick={() => {
                    void refreshPrizeStatusEvidence();
                  }}
                >
                  Refresh expired status proof
                </button>
              </>
            ) : null}

            {prize?.state === 2 ? (
              <button
                className="financial-primary-button"
                type="button"
                onClick={() => {
                  void assignNextChunk();
                }}
              >
                Assign next fixed entitlement chunk
              </button>
            ) : null}
          </div>
        </article>
      ) : null}

      {prize !== null && prize.state === 3 && selectedDrawId !== null && selectedSlot !== null ? (
        <article className="workspace-card block">
          <span className="eyebrow">HISTORICAL ENTITLEMENT</span>
          {entitlement === null ? (
            <div className="financial-state-card warning">
              <CircleDashed size={18} />
              <div>
                <strong>No initialized entitlement loaded for this slot</strong>
                <p>Refresh after assignment completes or select the correct historical slot.</p>
              </div>
            </div>
          ) : (
            <>
              <div className="financial-live-status">
                <div>
                  <span>Initialized</span>
                  <strong>{String(entitlement.initialized)}</strong>
                </div>
                <div>
                  <span>Historical beneficiary</span>
                  <strong>{entitlement.owner}</strong>
                </div>
                <div>
                  <span>Registration version</span>
                  <strong>{entitlement.registrationVersion.toString()}</strong>
                </div>
                <div>
                  <span>Reservation nonce</span>
                  <strong>{entitlement.reservationNonce.toString()}</strong>
                </div>
                <div>
                  <span>Private amount</span>
                  <strong>
                    {privateEntitlement === null
                      ? "Not decrypted"
                      : tokenDecimals === undefined
                        ? `${privateEntitlement.toString()} base units`
                        : `${formatUnits(privateEntitlement, tokenDecimals)} ${tokenSymbol}`}
                  </strong>
                </div>
              </div>

              <div className="workspace-inline-actions">
                <button
                  className="financial-secondary-button"
                  type="button"
                  disabled={entitlement.owner.toLowerCase() !== authenticatedAddress.toLowerCase()}
                  onClick={() => {
                    void authorizeEntitlement();
                  }}
                >
                  <WalletCards size={15} /> Prepare entitlement-decryption authorization
                </button>

                <button
                  className="financial-secondary-button"
                  type="button"
                  disabled={
                    loading ||
                    entitlement.owner.toLowerCase() !== authenticatedAddress.toLowerCase()
                  }
                  onClick={() => {
                    void revealEntitlement();
                  }}
                >
                  <LockKeyhole size={15} /> Reveal this private entitlement explicitly
                </button>
              </div>

              {privateEntitlement !== null && privateEntitlement > 0n ? (
                <>
                  <button
                    className="financial-secondary-button"
                    type="button"
                    onClick={() => {
                      void prepareClaimAuthorization();
                    }}
                  >
                    Prepare exact historical claim authorization
                  </button>

                  {claimAuthorization !== null ? (
                    <div className="action-review-table">
                      <div>
                        <span>Draw</span>
                        <strong>{claimAuthorization.drawId.toString()}</strong>
                      </div>
                      <div>
                        <span>Slot</span>
                        <strong>{claimAuthorization.slotIndex.toString()}</strong>
                      </div>
                      <div>
                        <span>Participant / recipient</span>
                        <strong>{claimAuthorization.participant}</strong>
                      </div>
                      <div>
                        <span>Claim nonce</span>
                        <strong>{claimAuthorization.nonce.toString()}</strong>
                      </div>
                      <div>
                        <span>Expiry</span>
                        <strong>{timeLabel(claimAuthorization.expiry)}</strong>
                      </div>
                    </div>
                  ) : null}

                  {claimAuthorization !== null && claimSignature === null ? (
                    <button
                      className="financial-primary-button"
                      type="button"
                      disabled={signTypedData.isPending}
                      onClick={() => {
                        void signClaimAuthorization();
                      }}
                    >
                      <Signature size={15} /> Sign exact EIP-712 claim authorization
                    </button>
                  ) : null}

                  {claimSignature !== null ? (
                    <button
                      className="financial-primary-button"
                      type="button"
                      onClick={() => {
                        void prepareClaimTransaction();
                      }}
                    >
                      Prepare exact prize-claim transaction
                    </button>
                  ) : null}
                </>
              ) : privateEntitlement === 0n ? (
                <div className="financial-state-card">
                  <CircleCheck size={18} />
                  <div>
                    <strong>No prize entitlement for this historical slot</strong>
                    <p>No claim transaction is prepared for a zero private entitlement.</p>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </article>
      ) : null}

      {prize?.state === 6 && selectedDrawId !== null ? (
        <article className="workspace-card block">
          <span className="eyebrow">CLAIM COMPLETION</span>
          <p>
            The transfer created a public global-zero consequence proof. It does not reveal the
            transferred prize amount.
          </p>
          <div className="workspace-inline-actions">
            <button
              className="financial-primary-button"
              type="button"
              disabled={loading || exact.review !== null || exact.attempt !== null}
              onClick={() => {
                void decryptClaimCompletion();
              }}
            >
              <LockKeyhole size={15} /> Decrypt public claim-completion evidence explicitly
            </button>
            <button
              className="financial-secondary-button"
              type="button"
              onClick={() => {
                void refreshClaimCompletionEvidence();
              }}
            >
              Refresh completion evidence if expired
            </button>
          </div>
        </article>
      ) : null}

      {prize?.state === 4 || prize?.state === 5 ? (
        <div className="financial-state-card">
          <CircleCheck size={18} />
          <div>
            <strong>{PRIZE_STATE_NAME[prize.state]}</strong>
            <p>
              {prize.state === 4
                ? "Prize liability is fully claimed."
                : "The frozen prize proved to be zero."}
            </p>
          </div>
        </div>
      ) : null}

      <ExactActionReviewCard controller={exact} />

      {publicEvidence !== null ? (
        <div className="financial-state-card">
          <ShieldCheck size={18} />
          <div>
            <strong>Explicitly decrypted public consequence</strong>
            <p>{publicEvidence}</p>
          </div>
        </div>
      ) : null}

      {notice !== null ? (
        <div className="financial-state-card warning">
          <ShieldCheck size={18} />
          <div>
            <strong>PrizeReserve notice</strong>
            <p>{notice}</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
