"use client";

import { toUserFacingError } from "@/lib/ui-error";

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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { encodeFunctionData, formatUnits, hashTypedData, type Address, type Hex } from "viem";
import { useMetadata, useZamaSDK } from "@zama-fhe/react-sdk";
import { useConnection, usePublicClient, useSignTypedData } from "wagmi";

import {
  type ClaimAuthorization,
  VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT,
  VEILPOT_POOL_V2_ABI,
  VEILPOT_RESERVE_ABI,
} from "@veilpot/protocol-sdk";

import { ExactActionReviewCard, useExactAction } from "@/components/exact-action-control";
import { VEILPOT_V2_EXACT_ACTION_SCOPE } from "@/lib/deployment-scope";
import {
  PRIZE_V2_STATE,
  assertV2xClaimAuthorization,
  buildV2xClaimAuthorization,
  buildV2xClaimTypedData,
} from "@/lib/prize-v2";

interface PrizeClaimSnapshot {
  readonly state: number;
  readonly participantCount: bigint;
}

interface EntitlementSnapshot {
  readonly drawId: bigint;
  readonly slotIndex: bigint;
  readonly initialized: boolean;
  readonly beneficiaryBound: boolean;
  readonly owner: Address;
  readonly registrationVersion: bigint;
  readonly reservationNonce: bigint;
  readonly amount: Hex;
}

interface ClaimCompletionSnapshot {
  readonly state: number;
  readonly slotIndex: bigint;
  readonly participant: Address;
  readonly claimNonce: bigint;
  readonly attemptNonce: bigint;
  readonly proofDeadline: bigint;
  readonly predicate: Hex;
  readonly context: Hex;
}

function errorMessage(error: unknown): string {
  return toUserFacingError(error, "The corrected V2.x entitlement or claim action stopped safely.");
}

function sameAddress(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function sameHex(left: Hex, right: Hex): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

function currentSeconds(): bigint {
  return BigInt(Math.floor(Date.now() / 1000));
}

function parsePositiveBigInt(value: string): bigint | null {
  if (!/^[1-9][0-9]*$/.test(value)) return null;
  return BigInt(value);
}

function parseUnsignedBigInt(value: string): bigint | null {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) return null;
  return BigInt(value);
}

function parsePublicBoolean(value: unknown): boolean {
  if (value === true || value === 1 || value === 1n || value === "1" || value === "true") {
    return true;
  }

  if (value === false || value === 0 || value === 0n || value === "0" || value === "false") {
    return false;
  }

  throw new Error("The claim-completion public proof did not return a canonical boolean.");
}

function parsePublicBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;

  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }

  if (typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value)) {
    return BigInt(value);
  }

  throw new Error("The claim-completion proof context is not a canonical unsigned integer.");
}

function readClear(values: Readonly<Record<string, unknown>>, handle: Hex): unknown {
  const entry = Object.entries(values).find(([key]) => key.toLowerCase() === handle.toLowerCase());

  if (entry === undefined) {
    throw new Error("Public decryption did not return the exact requested handle.");
  }

  return entry[1];
}

function entitlementKey(entitlement: EntitlementSnapshot): string {
  return [
    entitlement.drawId.toString(),
    entitlement.slotIndex.toString(),
    entitlement.owner.toLowerCase(),
    entitlement.registrationVersion.toString(),
    entitlement.reservationNonce.toString(),
    entitlement.amount.toLowerCase(),
  ].join(":");
}

function sameEntitlement(left: EntitlementSnapshot, right: EntitlementSnapshot): boolean {
  return (
    left.drawId === right.drawId &&
    left.slotIndex === right.slotIndex &&
    left.initialized === right.initialized &&
    left.beneficiaryBound === right.beneficiaryBound &&
    sameAddress(left.owner, right.owner) &&
    left.registrationVersion === right.registrationVersion &&
    left.reservationNonce === right.reservationNonce &&
    sameHex(left.amount, right.amount)
  );
}

function sameClaimCompletion(
  left: ClaimCompletionSnapshot,
  right: ClaimCompletionSnapshot,
): boolean {
  return (
    left.state === right.state &&
    left.slotIndex === right.slotIndex &&
    sameAddress(left.participant, right.participant) &&
    left.claimNonce === right.claimNonce &&
    left.attemptNonce === right.attemptNonce &&
    left.proofDeadline === right.proofDeadline &&
    sameHex(left.predicate, right.predicate) &&
    sameHex(left.context, right.context)
  );
}

function prizeStateName(state: number): string {
  switch (state) {
    case PRIZE_V2_STATE.UNPREPARED:
      return "UNPREPARED";
    case PRIZE_V2_STATE.STATUS_PROOF_PENDING:
      return "STATUS PROOF";
    case PRIZE_V2_STATE.ASSIGNING:
      return "ASSIGNING";
    case PRIZE_V2_STATE.CLAIMABLE:
      return "CLAIMABLE";
    case PRIZE_V2_STATE.CLAIMED:
      return "CLAIMED";
    case PRIZE_V2_STATE.NO_PRIZE:
      return "NO PRIZE";
    case PRIZE_V2_STATE.TRANSFER_PROOF_PENDING:
      return "TRANSFER PROOF";
    default:
      return `UNKNOWN ${String(state)}`;
  }
}

function compactAddress(address: string): string {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

export function PrizeClaimV2({ authenticatedAddress }: { readonly authenticatedAddress: Address }) {
  const connection = useConnection();
  const publicClient = usePublicClient({
    chainId: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId,
  });
  const metadata = useMetadata(VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.confidentialToken);
  const zama = useZamaSDK();
  const signTypedData = useSignTypedData();
  const exact = useExactAction(authenticatedAddress, VEILPOT_V2_EXACT_ACTION_SCOPE);

  const processedExactHash = useRef<Hex | null>(null);

  const [drawIdText, setDrawIdText] = useState("");
  const [slotText, setSlotText] = useState("");
  const [latestChildDraws, setLatestChildDraws] = useState<readonly bigint[]>([]);
  const [prize, setPrize] = useState<PrizeClaimSnapshot | null>(null);
  const [entitlement, setEntitlement] = useState<EntitlementSnapshot | null>(null);
  const [completion, setCompletion] = useState<ClaimCompletionSnapshot | null>(null);
  const [privateEntitlement, setPrivateEntitlement] = useState<bigint | null>(null);
  const [claimAuthorization, setClaimAuthorization] = useState<ClaimAuthorization | null>(null);
  const [claimDigest, setClaimDigest] = useState<Hex | null>(null);
  const [claimSignature, setClaimSignature] = useState<Hex | null>(null);
  const [pendingEntitlementAuthorizationKey, setPendingEntitlementAuthorizationKey] = useState<
    string | null
  >(null);
  const [authorizedEntitlementKey, setAuthorizedEntitlementKey] = useState<string | null>(null);
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [publicEvidence, setPublicEvidence] = useState<string | null>(null);

  const selectedDrawId = useMemo(() => parsePositiveBigInt(drawIdText), [drawIdText]);

  const selectedSlot = useMemo(() => parseUnsignedBigInt(slotText), [slotText]);

  const loadedEntitlementKey = useMemo(
    () => (entitlement === null ? null : entitlementKey(entitlement)),
    [entitlement],
  );

  const tokenDecimals = metadata.data?.decimals;
  const tokenSymbol = metadata.data?.symbol ?? "cUSDTMock";

  const readPrize = useCallback(
    async (drawId: bigint): Promise<PrizeClaimSnapshot | null> => {
      if (publicClient === undefined) {
        throw new Error("Ethereum Sepolia public client is unavailable.");
      }

      try {
        const row = await publicClient.readContract({
          address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.reserve,
          abi: VEILPOT_RESERVE_ABI,
          functionName: "prizeHandles",
          args: [drawId],
        });

        return {
          state: row[0],
          participantCount: row[6],
        };
      } catch {
        return null;
      }
    },
    [publicClient],
  );

  const readEntitlement = useCallback(
    async (drawId: bigint, slotIndex: bigint): Promise<EntitlementSnapshot> => {
      if (publicClient === undefined) {
        throw new Error("Ethereum Sepolia public client is unavailable.");
      }

      const row = await publicClient.readContract({
        address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.reserve,
        abi: VEILPOT_RESERVE_ABI,
        functionName: "prizeEntitlementRecord",
        args: [drawId, slotIndex],
      });

      return {
        drawId,
        slotIndex,
        initialized: row[0],
        beneficiaryBound: row[1],
        owner: row[2],
        registrationVersion: row[3],
        reservationNonce: row[4],
        amount: row[5],
      };
    },
    [publicClient],
  );

  const readCompletion = useCallback(
    async (drawId: bigint): Promise<ClaimCompletionSnapshot> => {
      if (publicClient === undefined) {
        throw new Error("Ethereum Sepolia public client is unavailable.");
      }

      const row = await publicClient.readContract({
        address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.reserve,
        abi: VEILPOT_RESERVE_ABI,
        functionName: "claimCompletionHandles",
        args: [drawId],
      });

      return {
        state: row[0],
        slotIndex: row[1],
        participant: row[2],
        claimNonce: row[3],
        attemptNonce: row[4],
        proofDeadline: row[5],
        predicate: row[6],
        context: row[7],
      };
    },
    [publicClient],
  );

  const resetPreparedClaim = useCallback(() => {
    setClaimAuthorization(null);
    setClaimDigest(null);
    setClaimSignature(null);
  }, []);

  const refresh = useCallback(async () => {
    if (publicClient === undefined) return;

    setLoadingKey("refresh");
    setNotice(null);

    try {
      const nextSnapshotId = await publicClient.readContract({
        address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
        abi: VEILPOT_POOL_V2_ABI,
        functionName: "nextDrawSnapshotId",
      });

      if (nextSnapshotId > 1n) {
        const latestSnapshotId = nextSnapshotId - 1n;

        const drawIds = await Promise.all(
          [0n, 1n, 2n].map((prizeIndex) =>
            publicClient.readContract({
              address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
              abi: VEILPOT_POOL_V2_ABI,
              functionName: "snapshotPrizeDrawId",
              args: [latestSnapshotId, prizeIndex],
            }),
          ),
        );

        setLatestChildDraws(drawIds.filter((drawId) => drawId > 0n));
      } else {
        setLatestChildDraws([]);
      }

      if (selectedDrawId === null) {
        setPrize(null);
        setEntitlement(null);
        setCompletion(null);
        return;
      }

      const nextPrize = await readPrize(selectedDrawId);
      setPrize(nextPrize);

      if (nextPrize?.state === PRIZE_V2_STATE.TRANSFER_PROOF_PENDING) {
        setCompletion(await readCompletion(selectedDrawId));
      } else {
        setCompletion(null);
      }

      if (
        selectedSlot !== null &&
        nextPrize !== null &&
        selectedSlot < nextPrize.participantCount
      ) {
        try {
          setEntitlement(await readEntitlement(selectedDrawId, selectedSlot));
        } catch {
          setEntitlement(null);
        }
      } else {
        setEntitlement(null);
      }
    } catch (error: unknown) {
      setNotice(errorMessage(error));
    } finally {
      setLoadingKey(null);
    }
  }, [publicClient, readCompletion, readEntitlement, readPrize, selectedDrawId, selectedSlot]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setPrivateEntitlement(null);
    resetPreparedClaim();

    setAuthorizedEntitlementKey((current) => (current === loadedEntitlementKey ? current : null));
  }, [loadedEntitlementKey, resetPreparedClaim]);

  useEffect(() => {
    if (exact.status.kind === "included" || exact.status.kind === "reverted") {
      if (processedExactHash.current === exact.status.hash) return;

      processedExactHash.current = exact.status.hash;

      if (exact.status.kind === "included") {
        setAuthorizedEntitlementKey(pendingEntitlementAuthorizationKey);
      }

      setPendingEntitlementAuthorizationKey(null);
      setPrivateEntitlement(null);
      resetPreparedClaim();
      void refresh();
      return;
    }

    if (
      exact.status.kind === "idle" &&
      exact.review === null &&
      exact.attempt === null &&
      pendingEntitlementAuthorizationKey !== null
    ) {
      setPendingEntitlementAuthorizationKey(null);
    }
  }, [
    exact.attempt,
    exact.review,
    exact.status,
    pendingEntitlementAuthorizationKey,
    refresh,
    resetPreparedClaim,
  ]);

  const chooseLatestDraw = useCallback(
    (drawId: bigint) => {
      setDrawIdText(drawId.toString());
      setSlotText("");
      setPrize(null);
      setEntitlement(null);
      setCompletion(null);
      setPrivateEntitlement(null);
      setAuthorizedEntitlementKey(null);
      setPendingEntitlementAuthorizationKey(null);
      setPublicEvidence(null);
      resetPreparedClaim();
      exact.discardReview();
    },
    [exact, resetPreparedClaim],
  );

  const loadExactEntitlement = useCallback(async () => {
    if (selectedDrawId === null || selectedSlot === null || prize === null) {
      setNotice("Enter an exact draw ID and historical slot first.");
      return;
    }

    if (selectedSlot >= prize.participantCount) {
      setNotice("Historical slot is outside this draw's frozen participant bound.");
      return;
    }

    setLoadingKey("load-entitlement");
    setNotice(null);

    try {
      const row = await readEntitlement(selectedDrawId, selectedSlot);

      if (
        !row.initialized ||
        !row.beneficiaryBound ||
        !sameAddress(row.owner, authenticatedAddress)
      ) {
        throw new Error(
          "This exact frozen historical slot is not an initialized entitlement owned by the authenticated wallet.",
        );
      }

      setEntitlement(row);
      setNotice("Exact historical entitlement identity loaded. The amount remains encrypted.");
    } catch (error: unknown) {
      setEntitlement(null);
      setNotice(errorMessage(error));
    } finally {
      setLoadingKey(null);
    }
  }, [authenticatedAddress, prize, readEntitlement, selectedDrawId, selectedSlot]);

  const discoverHistoricalEntitlement = useCallback(async () => {
    if (selectedDrawId === null || prize === null) {
      setNotice("Select an initialized prize draw first.");
      return;
    }

    if (prize.participantCount > 128n) {
      setNotice("The frozen participant count exceeds the reviewed Veilpot maximum.");
      return;
    }

    setLoadingKey("discover-entitlement");
    setNotice(
      "Searching only this draw's frozen historical entitlement records. Current participant ownership is not consulted.",
    );

    try {
      const matches: EntitlementSnapshot[] = [];
      const total = Number(prize.participantCount);

      for (let start = 0; start < total; start += 16) {
        const end = Math.min(total, start + 16);
        const indexes = Array.from({ length: end - start }, (_, offset) => BigInt(start + offset));

        const rows = await Promise.all(
          indexes.map((slotIndex) => readEntitlement(selectedDrawId, slotIndex)),
        );

        for (const row of rows) {
          if (
            row.initialized &&
            row.beneficiaryBound &&
            sameAddress(row.owner, authenticatedAddress)
          ) {
            matches.push(row);
          }
        }
      }

      if (matches.length === 0) {
        throw new Error(
          "No frozen historical entitlement record for the authenticated wallet was found in this draw.",
        );
      }

      if (matches.length > 1) {
        const slots = matches.map((row) => row.slotIndex.toString()).join(", ");

        throw new Error(
          `Multiple frozen historical records matched this wallet at slots ${slots}. Enter the exact slot explicitly.`,
        );
      }

      const match = matches[0];

      setSlotText(match.slotIndex.toString());
      setEntitlement(match);
      setNotice(
        `Historical entitlement found at frozen slot ${match.slotIndex.toString()}. Amount remains encrypted.`,
      );
    } catch (error: unknown) {
      setNotice(errorMessage(error));
    } finally {
      setLoadingKey(null);
    }
  }, [authenticatedAddress, prize, readEntitlement, selectedDrawId]);

  const prepareEntitlementAuthorization = useCallback(async () => {
    if (
      entitlement === null ||
      publicClient === undefined ||
      !sameAddress(entitlement.owner, authenticatedAddress)
    ) {
      setNotice("Load an exact historical entitlement owned by this wallet first.");
      return;
    }

    setNotice(null);

    try {
      const current = await readEntitlement(entitlement.drawId, entitlement.slotIndex);

      if (!sameEntitlement(current, entitlement)) {
        throw new Error(
          "The historical entitlement changed before authorization review. Reload it first.",
        );
      }

      const data = encodeFunctionData({
        abi: VEILPOT_RESERVE_ABI,
        functionName: "authorizeEntitlementDecryption",
        args: [entitlement.drawId, entitlement.slotIndex],
      });

      const review = await exact.prepare({
        key: `prize-v2:authorize-entitlement:${entitlement.drawId.toString()}:${entitlement.slotIndex.toString()}:${entitlement.amount.toLowerCase()}`,
        label: "Authorize this exact private entitlement handle",
        consequence:
          "Grant only the frozen historical owner persistent ACL access to the current encrypted entitlement handle. This transaction does not decrypt or reveal the entitlement.",
        to: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.reserve,
        data,
        value: 0n,
      });

      if (review !== null) {
        setPendingEntitlementAuthorizationKey(entitlementKey(entitlement));
        setNotice(
          "Exact entitlement-authorization transaction prepared. No decryption has occurred.",
        );
      }
    } catch (error: unknown) {
      setPendingEntitlementAuthorizationKey(null);
      setNotice(errorMessage(error));
    }
  }, [authenticatedAddress, entitlement, exact, publicClient, readEntitlement]);

  const revealEntitlement = useCallback(async () => {
    if (entitlement === null) {
      setNotice("Load the exact historical entitlement first.");
      return;
    }

    const expectedKey = entitlementKey(entitlement);

    if (authorizedEntitlementKey !== expectedKey) {
      setNotice(
        "This exact encrypted entitlement handle has not completed its explicit authorization transaction in this session.",
      );
      return;
    }

    if (
      connection.status !== "connected" ||
      !sameAddress(connection.address, authenticatedAddress) ||
      connection.chainId !== VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId
    ) {
      setNotice(
        "Connect the exact authenticated historical-owner wallet on Ethereum Sepolia before private reveal.",
      );
      return;
    }

    setLoadingKey("private-entitlement-reveal");
    setNotice(
      "Requesting private decryption of only this explicitly authorized entitlement handle. This may request a Zama permit signature.",
    );

    try {
      const before = await readEntitlement(entitlement.drawId, entitlement.slotIndex);

      if (!sameEntitlement(before, entitlement)) {
        throw new Error(
          "Entitlement identity or ciphertext changed before private decryption. The reveal was cancelled.",
        );
      }

      const result = await zama.decryption.decryptValues([
        {
          encryptedValue: before.amount,
          contractAddress: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.reserve,
        },
      ]);

      const after = await readEntitlement(entitlement.drawId, entitlement.slotIndex);

      if (!sameEntitlement(before, after)) {
        throw new Error(
          "Entitlement changed while private decryption was in progress. The stale clear value was discarded.",
        );
      }

      const clear = result[before.amount];

      if (clear === undefined) {
        throw new Error("Private decryption did not return the exact entitlement handle.");
      }

      setEntitlement(after);
      setPrivateEntitlement(BigInt(clear));
      setNotice(
        "Private entitlement revealed only in this authenticated wallet session. Nothing was made public on-chain.",
      );
    } catch (error: unknown) {
      setPrivateEntitlement(null);
      setNotice(errorMessage(error));
    } finally {
      setLoadingKey(null);
    }
  }, [
    authenticatedAddress,
    authorizedEntitlementKey,
    connection,
    entitlement,
    readEntitlement,
    zama.decryption,
  ]);

  const claimInputFromAuthorization = useCallback(
    (authorization: ClaimAuthorization) => ({
      drawId: authorization.drawId,
      slotIndex: authorization.slotIndex,
      owner: authorization.participant,
      registrationVersion: authorization.registrationVersion,
      reservationNonce: authorization.reservationNonce,
      nonce: authorization.nonce,
      expiry: authorization.expiry,
    }),
    [],
  );

  const preflightPreparedClaim = useCallback(
    async (
      authorization: ClaimAuthorization,
      signature: Hex | null,
    ): Promise<{
      readonly digest: Hex;
      readonly typedData: ReturnType<typeof buildV2xClaimTypedData>;
    }> => {
      if (
        publicClient === undefined ||
        entitlement === null ||
        prize?.state !== PRIZE_V2_STATE.CLAIMABLE
      ) {
        throw new Error("A current CLAIMABLE historical entitlement is required.");
      }

      assertV2xClaimAuthorization(authorization);

      if (
        !sameAddress(authorization.participant, authenticatedAddress) ||
        !sameAddress(authorization.recipient, authenticatedAddress)
      ) {
        throw new Error("Prepared claim is not bound to the authenticated historical owner.");
      }

      if (currentSeconds() > authorization.expiry) {
        throw new Error("The prepared claim authorization has expired. Prepare a new one.");
      }

      const current = await readEntitlement(entitlement.drawId, entitlement.slotIndex);

      if (!sameEntitlement(current, entitlement)) {
        throw new Error(
          "The encrypted entitlement changed after claim preparation. Discard the stale claim authorization.",
        );
      }

      if (
        authorization.drawId !== current.drawId ||
        authorization.slotIndex !== current.slotIndex ||
        authorization.registrationVersion !== current.registrationVersion ||
        authorization.reservationNonce !== current.reservationNonce
      ) {
        throw new Error(
          "Prepared claim no longer matches the exact historical entitlement identity.",
        );
      }

      const nonce = await publicClient.readContract({
        address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.reserve,
        abi: VEILPOT_RESERVE_ABI,
        functionName: "nextClaimNonce",
        args: [authenticatedAddress],
      });

      if (nonce !== authorization.nonce) {
        throw new Error(
          "The participant-global claim nonce changed. Prepare a fresh authorization.",
        );
      }

      const typedData = buildV2xClaimTypedData(claimInputFromAuthorization(authorization));

      const localDigest = hashTypedData(typedData);

      const onchainDigest = await publicClient.readContract({
        address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.reserve,
        abi: VEILPOT_RESERVE_ABI,
        functionName: "claimAuthorizationDigest",
        args: [authorization],
      });

      if (!sameHex(localDigest, onchainDigest)) {
        throw new Error(
          "Local corrected V2.x EIP-712 digest does not match the active Prize Reserve digest.",
        );
      }

      if (signature !== null) {
        const validatedDigest = await publicClient.readContract({
          address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.reserve,
          abi: VEILPOT_RESERVE_ABI,
          functionName: "validateClaimAuthorization",
          args: [authorization, signature],
        });

        if (!sameHex(validatedDigest, onchainDigest)) {
          throw new Error(
            "Active Prize Reserve signature validation returned an unexpected digest.",
          );
        }
      }

      return {
        digest: onchainDigest,
        typedData,
      };
    },
    [
      authenticatedAddress,
      claimInputFromAuthorization,
      entitlement,
      prize?.state,
      publicClient,
      readEntitlement,
    ],
  );

  const prepareClaimAuthorization = useCallback(async () => {
    if (
      entitlement === null ||
      publicClient === undefined ||
      prize?.state !== PRIZE_V2_STATE.CLAIMABLE
    ) {
      setNotice("Load an owner-bound entitlement from a CLAIMABLE draw first.");
      return;
    }

    setLoadingKey("prepare-claim");
    setNotice(null);

    try {
      const current = await readEntitlement(entitlement.drawId, entitlement.slotIndex);

      if (
        !sameEntitlement(current, entitlement) ||
        !current.initialized ||
        !current.beneficiaryBound ||
        !sameAddress(current.owner, authenticatedAddress)
      ) {
        throw new Error(
          "Historical entitlement identity changed or is not owned by the authenticated wallet.",
        );
      }

      const nonce = await publicClient.readContract({
        address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.reserve,
        abi: VEILPOT_RESERVE_ABI,
        functionName: "nextClaimNonce",
        args: [authenticatedAddress],
      });

      const authorization = buildV2xClaimAuthorization({
        drawId: current.drawId,
        slotIndex: current.slotIndex,
        owner: authenticatedAddress,
        registrationVersion: current.registrationVersion,
        reservationNonce: current.reservationNonce,
        nonce,
        expiry: currentSeconds() + 3_600n,
      });

      assertV2xClaimAuthorization(authorization);

      const typedData = buildV2xClaimTypedData({
        drawId: authorization.drawId,
        slotIndex: authorization.slotIndex,
        owner: authorization.participant,
        registrationVersion: authorization.registrationVersion,
        reservationNonce: authorization.reservationNonce,
        nonce: authorization.nonce,
        expiry: authorization.expiry,
      });

      const localDigest = hashTypedData(typedData);

      const onchainDigest = await publicClient.readContract({
        address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.reserve,
        abi: VEILPOT_RESERVE_ABI,
        functionName: "claimAuthorizationDigest",
        args: [authorization],
      });

      if (!sameHex(localDigest, onchainDigest)) {
        throw new Error("Local claim digest does not match the active Prize Reserve.");
      }

      setClaimAuthorization(authorization);
      setClaimDigest(onchainDigest);
      setClaimSignature(null);

      setNotice(
        "Exact claim authorization prepared for one hour. No wallet signature was requested.",
      );
    } catch (error: unknown) {
      resetPreparedClaim();
      setNotice(errorMessage(error));
    } finally {
      setLoadingKey(null);
    }
  }, [
    authenticatedAddress,
    entitlement,
    prize?.state,
    publicClient,
    readEntitlement,
    resetPreparedClaim,
  ]);

  const signClaimAuthorization = useCallback(async () => {
    if (claimAuthorization === null || claimDigest === null) {
      setNotice("Prepare an exact claim authorization first.");
      return;
    }

    if (
      connection.status !== "connected" ||
      !sameAddress(connection.address, authenticatedAddress) ||
      connection.chainId !== VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId
    ) {
      setNotice(
        "Connect the exact authenticated historical-owner wallet on Ethereum Sepolia before signing.",
      );
      return;
    }

    setLoadingKey("sign-claim");
    setNotice(
      "Rechecking the exact entitlement, participant-global nonce and active Prize Reserve digest before opening a signature request.",
    );

    try {
      const preflight = await preflightPreparedClaim(claimAuthorization, null);

      if (!sameHex(preflight.digest, claimDigest)) {
        throw new Error("Prepared claim digest changed before signature.");
      }

      const signature = await signTypedData.mutateAsync(preflight.typedData);

      const validatedDigest = await publicClient?.readContract({
        address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.reserve,
        abi: VEILPOT_RESERVE_ABI,
        functionName: "validateClaimAuthorization",
        args: [claimAuthorization, signature],
      });

      if (validatedDigest === undefined || !sameHex(validatedDigest, claimDigest)) {
        throw new Error(
          "The active Prize Reserve did not validate the exact historical-owner signature.",
        );
      }

      setClaimSignature(signature);
      setNotice(
        "Exact EIP-712 authorization signed and read-only validated. No prize transaction was submitted.",
      );
    } catch (error: unknown) {
      setClaimSignature(null);
      setNotice(errorMessage(error));
    } finally {
      setLoadingKey(null);
    }
  }, [
    authenticatedAddress,
    claimAuthorization,
    claimDigest,
    connection,
    preflightPreparedClaim,
    publicClient,
    signTypedData,
  ]);

  const prepareClaimTransaction = useCallback(async () => {
    if (claimAuthorization === null || claimSignature === null || claimDigest === null) {
      setNotice("An exact validated claim signature is required before transaction review.");
      return;
    }

    setLoadingKey("prepare-claim-transaction");
    setNotice(null);

    try {
      const preflight = await preflightPreparedClaim(claimAuthorization, claimSignature);

      if (!sameHex(preflight.digest, claimDigest)) {
        throw new Error("Claim digest changed before transaction preparation.");
      }

      const data = encodeFunctionData({
        abi: VEILPOT_RESERVE_ABI,
        functionName: "claimPrize",
        args: [claimAuthorization, claimSignature],
      });

      await exact.prepare({
        key: `prize-v2:claim:${claimAuthorization.drawId.toString()}:${claimAuthorization.slotIndex.toString()}:${claimAuthorization.nonce.toString()}`,
        label: "Claim exact private prize entitlement",
        consequence:
          "Submit the already signed historical-owner authorization to the active Prize Reserve. The reserve transfers only the encrypted entitlement and starts public proof-backed completion evidence. The payout amount remains confidential.",
        to: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.reserve,
        data,
        value: 0n,
      });

      setNotice(
        "Exact claim transaction review prepared. Opening the wallet and submitting remain separate explicit actions.",
      );
    } catch (error: unknown) {
      setNotice(errorMessage(error));
    } finally {
      setLoadingKey(null);
    }
  }, [claimAuthorization, claimDigest, claimSignature, exact, preflightPreparedClaim]);

  const settleClaimCompletion = useCallback(async () => {
    if (selectedDrawId === null || prize?.state !== PRIZE_V2_STATE.TRANSFER_PROOF_PENDING) {
      setNotice("Claim-completion evidence exists only in TRANSFER_PROOF_PENDING.");
      return;
    }

    setLoadingKey("claim-completion-proof");
    setNotice(
      "Explicitly decrypting only the contract-authorized global-zero completion predicate and exact proof context. No prize amount is decrypted.",
    );

    try {
      const before = await readCompletion(selectedDrawId);

      if (before.state !== PRIZE_V2_STATE.TRANSFER_PROOF_PENDING) {
        throw new Error("The claim is no longer in TRANSFER_PROOF_PENDING.");
      }

      if (currentSeconds() > before.proofDeadline) {
        throw new Error("Claim-completion evidence expired. Refresh it before public decryption.");
      }

      const result = await zama.decryption.decryptPublicValues([before.predicate, before.context], {
        timeout: 180_000,
      });

      if (currentSeconds() > before.proofDeadline) {
        throw new Error(
          "The inclusive claim-completion deadline expired during decryption. The stale proof was discarded.",
        );
      }

      const complete = parsePublicBoolean(readClear(result.clearValues, before.predicate));
      const clearContext = parsePublicBigInt(readClear(result.clearValues, before.context));

      const after = await readCompletion(selectedDrawId);

      if (!sameClaimCompletion(before, after)) {
        throw new Error(
          "Claim-completion evidence changed during public decryption. The stale proof was discarded.",
        );
      }

      const data = encodeFunctionData({
        abi: VEILPOT_RESERVE_ABI,
        functionName: "settleClaimCompletion",
        args: [selectedDrawId, before.attemptNonce, complete, result.decryptionProof],
      });

      await exact.prepare({
        key: `prize-v2:settle-claim:${selectedDrawId.toString()}:${before.attemptNonce.toString()}`,
        label: "Settle exact claim-completion evidence",
        consequence: complete
          ? "Verify the draw-global encrypted residual is exactly zero and move the prize to terminal CLAIMED."
          : "Verify encrypted residual liability remains and return the prize to CLAIMABLE for a later owner-authorized claim.",
        to: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.reserve,
        data,
        value: 0n,
      });

      setPublicEvidence(
        `Claim completion draw ${selectedDrawId.toString()}: complete=${String(complete)}, proofContext=${clearContext.toString()}. No confidential payout amount was revealed.`,
      );
    } catch (error: unknown) {
      setNotice(errorMessage(error));
    } finally {
      setLoadingKey(null);
    }
  }, [exact, prize?.state, readCompletion, selectedDrawId, zama.decryption]);

  const refreshClaimCompletionEvidence = useCallback(async () => {
    if (selectedDrawId === null || prize?.state !== PRIZE_V2_STATE.TRANSFER_PROOF_PENDING) {
      setNotice("There is no pending claim-completion proof request to refresh.");
      return;
    }

    setLoadingKey("refresh-claim-completion");
    setNotice(null);

    try {
      const current = await readCompletion(selectedDrawId);

      if (currentSeconds() <= current.proofDeadline) {
        throw new Error(
          "Claim-completion evidence remains valid through its inclusive deadline and cannot be refreshed yet.",
        );
      }

      const data = encodeFunctionData({
        abi: VEILPOT_RESERVE_ABI,
        functionName: "refreshClaimCompletionEvidence",
        args: [selectedDrawId],
      });

      await exact.prepare({
        key: `prize-v2:refresh-claim:${selectedDrawId.toString()}:${current.attemptNonce.toString()}`,
        label: "Refresh expired claim-completion evidence",
        consequence:
          "Replace only the expired public completion predicate/context with a fresh attempt. Encrypted residuals, accounting and participant claim nonce remain unchanged.",
        to: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.reserve,
        data,
        value: 0n,
      });
    } catch (error: unknown) {
      setNotice(errorMessage(error));
    } finally {
      setLoadingKey(null);
    }
  }, [exact, prize?.state, readCompletion, selectedDrawId]);

  const exactBlocked = loadingKey !== null || exact.review !== null || exact.attempt !== null;

  const entitlementAuthorized =
    entitlement !== null && authorizedEntitlementKey === entitlementKey(entitlement);

  const completionExpired = completion !== null && currentSeconds() > completion.proofDeadline;

  return (
    <section className="workspace-stack">
      <article className="workspace-card block">
        <Gift size={21} aria-hidden="true" />

        <span className="eyebrow">PRIVATE ENTITLEMENT + CLAIM</span>

        <h2>Claim without exposing the prize amount.</h2>

        <p>
          Historical entitlement identity is read only from the frozen Prize Reserve record. Current
          participant ownership is never used to infer a claim. Authorization, private reveal,
          EIP-712 signing, claim submission and completion settlement remain separate actions.
        </p>

        <div className="financial-form-grid">
          <label>
            <span>Exact prize draw ID</span>

            <input
              inputMode="numeric"
              value={drawIdText}
              placeholder="1"
              onChange={(event) => {
                setDrawIdText(event.target.value);
                setSlotText("");
                setPrize(null);
                setEntitlement(null);
                setCompletion(null);
                setPrivateEntitlement(null);
                setAuthorizedEntitlementKey(null);
                setPendingEntitlementAuthorizationKey(null);
                setPublicEvidence(null);
                resetPreparedClaim();
                exact.discardReview();
              }}
            />
          </label>

          <label>
            <span>Frozen historical slot</span>

            <input
              inputMode="numeric"
              value={slotText}
              placeholder="0"
              onChange={(event) => {
                setSlotText(event.target.value);
                setEntitlement(null);
                setPrivateEntitlement(null);
                setAuthorizedEntitlementKey(null);
                setPendingEntitlementAuthorizationKey(null);
                resetPreparedClaim();
                exact.discardReview();
              }}
            />
          </label>
        </div>

        <div className="workspace-inline-actions">
          <button
            className="financial-secondary-button"
            type="button"
            disabled={exactBlocked}
            onClick={() => {
              void refresh();
            }}
          >
            <RefreshCw size={15} aria-hidden="true" />
            Refresh exact claim state
          </button>

          {latestChildDraws.map((drawId, index) => (
            <button
              className="financial-secondary-button"
              type="button"
              key={drawId.toString()}
              disabled={exactBlocked}
              onClick={() => {
                chooseLatestDraw(drawId);
              }}
            >
              Prize {index + 1} · Draw {drawId.toString()}
            </button>
          ))}
        </div>

        {selectedDrawId === null ? (
          <div className="financial-state-card">
            <CircleDashed size={18} aria-hidden="true" />

            <div>
              <strong>Select an exact draw</strong>
              <p>Veilpot does not infer a claim from the wallet&apos;s current participant slot.</p>
            </div>
          </div>
        ) : prize === null ? (
          <div className="financial-state-card">
            <CircleDashed size={18} aria-hidden="true" />

            <div>
              <strong>No initialized Prize Reserve record</strong>
              <p>
                Draw {selectedDrawId.toString()} has no readable initialized prize state in the
                active Prize Reserve.
              </p>
            </div>
          </div>
        ) : (
          <div className="financial-state-card">
            {prize.state === PRIZE_V2_STATE.CLAIMED ? (
              <CircleCheck size={18} aria-hidden="true" />
            ) : (
              <CircleDashed size={18} aria-hidden="true" />
            )}

            <div>
              <strong>{prizeStateName(prize.state)}</strong>
              <p>
                Draw {selectedDrawId.toString()} · frozen participant bound{" "}
                {prize.participantCount.toString()}
              </p>
            </div>
          </div>
        )}
      </article>

      {prize !== null &&
      selectedDrawId !== null &&
      (prize.state === PRIZE_V2_STATE.CLAIMABLE || prize.state === PRIZE_V2_STATE.CLAIMED) ? (
        <article className="workspace-card block">
          <LockKeyhole size={21} aria-hidden="true" />

          <span className="eyebrow">FROZEN HISTORICAL ENTITLEMENT</span>

          <h2>Identity first. Amount stays sealed.</h2>

          <p>
            Load an exact slot or discover this wallet only through the draw&apos;s immutable
            historical entitlement records.
          </p>

          <div className="workspace-inline-actions">
            <button
              className="financial-secondary-button"
              type="button"
              disabled={
                exactBlocked || selectedSlot === null || selectedSlot >= prize.participantCount
              }
              onClick={() => {
                void loadExactEntitlement();
              }}
            >
              <WalletCards size={15} aria-hidden="true" />
              Load exact historical slot
            </button>

            <button
              className="financial-secondary-button"
              type="button"
              disabled={exactBlocked}
              onClick={() => {
                void discoverHistoricalEntitlement();
              }}
            >
              <RefreshCw size={15} aria-hidden="true" />
              Find my frozen historical slot
            </button>
          </div>

          {entitlement !== null ? (
            <>
              <div className="financial-live-status">
                <div>
                  <span>Historical slot</span>
                  <strong>{entitlement.slotIndex.toString()}</strong>
                </div>

                <div>
                  <span>Frozen owner</span>
                  <strong>{compactAddress(entitlement.owner)}</strong>
                </div>

                <div>
                  <span>Registration version</span>
                  <strong>{entitlement.registrationVersion.toString()}</strong>
                </div>

                <div>
                  <span>Reservation nonce</span>
                  <strong>{entitlement.reservationNonce.toString()}</strong>
                </div>
              </div>

              <div className="financial-state-card">
                <LockKeyhole size={18} aria-hidden="true" />

                <div>
                  <strong>Private entitlement amount</strong>
                  <p>
                    {privateEntitlement === null
                      ? "Sealed. No automatic decryption."
                      : tokenDecimals === undefined
                        ? `${privateEntitlement.toString()} private token units`
                        : `${formatUnits(privateEntitlement, tokenDecimals)} ${tokenSymbol}`}
                  </p>
                </div>
              </div>

              <div className="workspace-inline-actions">
                <button
                  className="financial-secondary-button"
                  type="button"
                  disabled={exactBlocked || !sameAddress(entitlement.owner, authenticatedAddress)}
                  onClick={() => {
                    void prepareEntitlementAuthorization();
                  }}
                >
                  <WalletCards size={15} aria-hidden="true" />
                  Prepare private-reveal authorization
                </button>

                <button
                  className="financial-secondary-button"
                  type="button"
                  disabled={exactBlocked || !entitlementAuthorized}
                  onClick={() => {
                    void revealEntitlement();
                  }}
                >
                  <LockKeyhole size={15} aria-hidden="true" />
                  Reveal this entitlement privately
                </button>

                {prize.state === PRIZE_V2_STATE.CLAIMABLE ? (
                  <button
                    className="financial-secondary-button"
                    type="button"
                    disabled={exactBlocked}
                    onClick={() => {
                      void prepareClaimAuthorization();
                    }}
                  >
                    Prepare corrected V2.x claim authorization
                  </button>
                ) : null}
              </div>

              {entitlementAuthorized ? (
                <div className="financial-state-card">
                  <CircleCheck size={18} aria-hidden="true" />

                  <div>
                    <strong>Current entitlement handle authorized</strong>
                    <p>
                      Authorization did not decrypt it. A partial claim can replace this ciphertext
                      and will require a fresh authorization before another reveal.
                    </p>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </article>
      ) : null}

      {claimAuthorization !== null && claimDigest !== null ? (
        <article className="workspace-card block">
          <Signature size={21} aria-hidden="true" />

          <span className="eyebrow">EXACT EIP-712 CLAIM AUTHORIZATION</span>

          <h2>Signature and transaction stay separate.</h2>

          <div className="financial-live-status">
            <div>
              <span>Participant / recipient</span>
              <strong>{compactAddress(claimAuthorization.participant)}</strong>
            </div>

            <div>
              <span>Claim nonce</span>
              <strong>{claimAuthorization.nonce.toString()}</strong>
            </div>

            <div>
              <span>Expiry</span>
              <strong>{new Date(Number(claimAuthorization.expiry) * 1000).toLocaleString()}</strong>
            </div>

            <div>
              <span>Reserve digest</span>
              <strong>
                {claimDigest.slice(0, 10)}…{claimDigest.slice(-8)}
              </strong>
            </div>
          </div>

          <div className="workspace-inline-actions">
            {claimSignature === null ? (
              <button
                className="financial-primary-button"
                type="button"
                disabled={exactBlocked || signTypedData.isPending}
                onClick={() => {
                  void signClaimAuthorization();
                }}
              >
                <Signature size={15} aria-hidden="true" />
                Sign exact corrected V2.x authorization
              </button>
            ) : (
              <button
                className="financial-primary-button"
                type="button"
                disabled={exactBlocked}
                onClick={() => {
                  void prepareClaimTransaction();
                }}
              >
                <Gift size={15} aria-hidden="true" />
                Prepare separate claim transaction
              </button>
            )}
          </div>

          {claimSignature !== null ? (
            <div className="financial-state-card">
              <CircleCheck size={18} aria-hidden="true" />

              <div>
                <strong>Signature validated by active Prize Reserve</strong>
                <p>No claim transaction is submitted automatically after signing.</p>
              </div>
            </div>
          ) : null}
        </article>
      ) : null}

      {selectedDrawId !== null &&
      prize?.state === PRIZE_V2_STATE.TRANSFER_PROOF_PENDING &&
      completion !== null ? (
        <article className="workspace-card block">
          <ShieldCheck size={21} aria-hidden="true" />

          <span className="eyebrow">CLAIM COMPLETION · PUBLIC CONSEQUENCE ONLY</span>

          <h2>Transaction inclusion is not terminal settlement.</h2>

          <p>
            Completion evidence proves only whether the draw-global encrypted residual reached zero.
            It never reveals the payout amount.
          </p>

          <div className="financial-live-status">
            <div>
              <span>Historical slot</span>
              <strong>{completion.slotIndex.toString()}</strong>
            </div>

            <div>
              <span>Participant</span>
              <strong>{compactAddress(completion.participant)}</strong>
            </div>

            <div>
              <span>Claim nonce</span>
              <strong>{completion.claimNonce.toString()}</strong>
            </div>

            <div>
              <span>Proof attempt</span>
              <strong>{completion.attemptNonce.toString()}</strong>
            </div>
          </div>

          <div className="workspace-inline-actions">
            {!completionExpired ? (
              <button
                className="financial-secondary-button"
                type="button"
                disabled={exactBlocked}
                onClick={() => {
                  void settleClaimCompletion();
                }}
              >
                <LockKeyhole size={15} aria-hidden="true" />
                Decrypt public completion evidence
              </button>
            ) : (
              <button
                className="financial-secondary-button"
                type="button"
                disabled={exactBlocked}
                onClick={() => {
                  void refreshClaimCompletionEvidence();
                }}
              >
                <RefreshCw size={15} aria-hidden="true" />
                Refresh expired completion evidence
              </button>
            )}
          </div>
        </article>
      ) : null}

      <ExactActionReviewCard controller={exact} />

      {publicEvidence !== null ? (
        <div className="financial-state-card">
          <ShieldCheck size={18} aria-hidden="true" />

          <div>
            <strong>Explicit public completion evidence</strong>
            <p>{publicEvidence}</p>
          </div>
        </div>
      ) : null}

      {notice !== null ? (
        <div className="financial-state-card warning">
          <ShieldCheck size={18} aria-hidden="true" />

          <div>
            <strong>Entitlement / Claim notice</strong>
            <p>{notice}</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
