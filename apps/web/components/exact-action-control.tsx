"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Address, Hex } from "viem";
import { useConnection, usePublicClient, useSendTransaction } from "wagmi";

import {
  EXACT_ACTION_REVIEW_MAX_AGE_SECONDS,
  createExactActionAttempt,
  createExactActionReview,
  exactActionAttemptMatchesScope,
  exactActionDestinationAllowed,
  exactActionReviewInvalidReason,
  exactActionStorageKey,
  exactActionTransactionInvalidReason,
  isExplicitWalletRejection,
  parseExactActionAttempt,
  serializeExactActionAttempt,
  withExactActionHash,
  type ExactActionAttempt,
  type ExactActionDeploymentScope,
  type ExactActionReview,
} from "@/lib/exact-action";
import { VEILPOT_V1_EXACT_ACTION_SCOPE } from "@/lib/deployment-scope";

const EXACT_ACTION_SYNC_EVENT = "veilpot:exact-action-attempt-sync";

export type ExactActionStatus =
  | { readonly kind: "idle" }
  | { readonly kind: "ready"; readonly message: string }
  | { readonly kind: "wallet"; readonly message: string }
  | { readonly kind: "blocked"; readonly message: string; readonly hash?: Hex }
  | { readonly kind: "included"; readonly message: string; readonly hash: Hex }
  | { readonly kind: "reverted"; readonly message: string; readonly hash: Hex }
  | { readonly kind: "error"; readonly message: string };

interface PrepareExactActionInput {
  readonly key: string;
  readonly label: string;
  readonly consequence: string;
  readonly to: Address;
  readonly data: Hex;
  readonly value?: bigint;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return "The exact transaction action stopped safely.";
}

export function useExactAction(
  authenticatedAddress: Address,
  scope: ExactActionDeploymentScope = VEILPOT_V1_EXACT_ACTION_SCOPE,
) {
  const connection = useConnection();
  const publicClient = usePublicClient({
    chainId: scope.chainId,
  });
  const sendMutation = useSendTransaction();

  const [review, setReview] = useState<ExactActionReview | null>(null);
  const [attempt, setAttempt] = useState<ExactActionAttempt | null>(null);
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  const [status, setStatus] = useState<ExactActionStatus>({ kind: "idle" });

  const storageKey = useMemo(
    () => exactActionStorageKey(scope, authenticatedAddress),
    [authenticatedAddress, scope],
  );

  const persistAttempt = useCallback(
    (record: ExactActionAttempt) => {
      setAttempt(record);
      try {
        window.localStorage.setItem(storageKey, serializeExactActionAttempt(record));
      } catch {
        // In-memory blocking remains active.
      }
      window.dispatchEvent(
        new CustomEvent(EXACT_ACTION_SYNC_EVENT, {
          detail: { storageKey, attempt: record },
        }),
      );
    },
    [storageKey],
  );

  const clearAttempt = useCallback(() => {
    setAttempt(null);
    try {
      window.localStorage.removeItem(storageKey);
    } catch {
      // In-memory state is already clear.
    }
    window.dispatchEvent(
      new CustomEvent(EXACT_ACTION_SYNC_EVENT, {
        detail: { storageKey, attempt: null },
      }),
    );
  }, [storageKey]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      if (stored === null) {
        setAttempt(null);
      } else {
        const parsed = parseExactActionAttempt(stored);
        if (
          parsed !== null &&
          exactActionAttemptMatchesScope(parsed, scope, authenticatedAddress)
        ) {
          setAttempt(parsed);
          setStatus({
            kind: "blocked",
            message:
              "An earlier wallet attempt must be reconciled before another exact transaction review.",
            ...(parsed.hash === null ? {} : { hash: parsed.hash }),
          });
        } else {
          window.localStorage.removeItem(storageKey);
          setAttempt(null);
        }
      }
    } catch {
      setAttempt(null);
    } finally {
      setLoadedKey(storageKey);
    }
  }, [authenticatedAddress, scope, storageKey]);

  const storageReady = loadedKey === storageKey;

  useEffect(() => {
    const onSync = (event: Event) => {
      const custom = event as CustomEvent<{
        readonly storageKey: string;
        readonly attempt: ExactActionAttempt | null;
      }>;
      if (custom.detail.storageKey !== storageKey) return;

      const next = custom.detail.attempt;
      if (next === null) {
        setAttempt(null);
        return;
      }

      setAttempt(next);
      setReview(null);
      setStatus({
        kind: "blocked",
        message:
          "Another visible Veilpot control owns an unresolved exact wallet attempt. Reconcile it before preparing another action.",
        ...(next.hash === null ? {} : { hash: next.hash }),
      });
    };
    window.addEventListener(EXACT_ACTION_SYNC_EVENT, onSync);
    return () => {
      window.removeEventListener(EXACT_ACTION_SYNC_EVENT, onSync);
    };
  }, [storageKey]);

  useEffect(() => {
    if (review === null) return;
    const staleAt = (review.preparedAt + EXACT_ACTION_REVIEW_MAX_AGE_SECONDS) * 1000;
    const delay = Math.max(0, staleAt - Date.now());
    const timeout = window.setTimeout(() => {
      setReview(null);
      setStatus({
        kind: "error",
        message:
          "The exact transaction review became stale. No replacement transaction was generated.",
      });
    }, delay);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [review]);

  const prepare = useCallback(
    async (input: PrepareExactActionInput): Promise<ExactActionReview | null> => {
      setReview(null);
      setStatus({ kind: "idle" });

      if (!storageReady) {
        setStatus({
          kind: "error",
          message: "Veilpot is still checking for an unresolved wallet attempt.",
        });
        return null;
      }
      if (attempt !== null) {
        setStatus({
          kind: "blocked",
          message:
            "A previous exact wallet attempt is unresolved. Reconcile it before preparing another transaction.",
          ...(attempt.hash === null ? {} : { hash: attempt.hash }),
        });
        return null;
      }
      if (!exactActionDestinationAllowed(scope, input.to)) {
        setStatus({
          kind: "error",
          message: "The requested destination is outside the active Veilpot deployment scope.",
        });
        return null;
      }
      if (
        connection.status !== "connected" ||
        connection.address.toLowerCase() !== authenticatedAddress.toLowerCase() ||
        connection.chainId !== scope.chainId ||
        publicClient === undefined
      ) {
        setStatus({
          kind: "error",
          message: "Connect the authenticated wallet on Ethereum Sepolia before review.",
        });
        return null;
      }

      try {
        const value = input.value ?? 0n;
        const accountNonce = await publicClient.getTransactionCount({
          address: connection.address,
          blockTag: "pending",
        });

        await publicClient.call({
          account: connection.address,
          to: input.to,
          data: input.data,
          value,
        });

        const next = createExactActionReview({
          ...input,
          sender: connection.address,
          value,
          chainId: scope.chainId,
          accountNonce,
          preparedAt: Math.floor(Date.now() / 1000),
        });
        setReview(next);
        setStatus({
          kind: "ready",
          message:
            "Exact calldata simulated successfully. Opening the wallet is a separate action.",
        });
        return next;
      } catch (error: unknown) {
        setStatus({
          kind: "error",
          message:
            "Exact transaction simulation failed. Nothing was submitted. " + errorMessage(error),
        });
        return null;
      }
    },
    [attempt, authenticatedAddress, connection, publicClient, scope, storageReady],
  );

  const verifySubmitted = useCallback(
    async (record: ExactActionAttempt, hash: Hex): Promise<boolean> => {
      if (publicClient === undefined) return false;

      const [receipt, transaction] = await Promise.all([
        publicClient.getTransactionReceipt({ hash }),
        publicClient.getTransaction({ hash }),
      ]);

      const invalidReason = exactActionTransactionInvalidReason(record, {
        from: transaction.from,
        to: transaction.to,
        input: transaction.input,
        nonce: transaction.nonce,
        value: transaction.value,
      });

      if (invalidReason !== null) {
        setStatus({
          kind: "blocked",
          hash,
          message: `${invalidReason} Keep this exact attempt blocked and do not retry.`,
        });
        return false;
      }

      if (receipt.status === "reverted") {
        clearAttempt();
        setReview(null);
        setStatus({
          kind: "reverted",
          hash,
          message:
            "The exact reviewed transaction was mined with failure. It was not retried automatically.",
        });
        return false;
      }

      clearAttempt();
      setReview(null);
      setStatus({
        kind: "included",
        hash,
        message:
          "The exact reviewed transaction mined successfully and its raw identity was reconciled.",
      });
      return true;
    },
    [clearAttempt, publicClient],
  );

  const openWallet = useCallback(async (): Promise<Hex | null> => {
    const current = review;
    if (current === null || publicClient === undefined) {
      setStatus({ kind: "error", message: "Prepare a fresh exact review first." });
      return null;
    }
    if (!storageReady || attempt !== null) {
      setReview(null);
      setStatus({
        kind: "blocked",
        message: "An unresolved wallet attempt must be reconciled before another wallet request.",
        ...(attempt?.hash === null || attempt?.hash === undefined ? {} : { hash: attempt.hash }),
      });
      return null;
    }
    if (!exactActionDestinationAllowed(scope, current.to)) {
      setReview(null);
      setStatus({
        kind: "error",
        message:
          "The reviewed destination no longer belongs to the active Veilpot deployment scope.",
      });
      return null;
    }
    if (
      connection.status !== "connected" ||
      connection.address.toLowerCase() !== authenticatedAddress.toLowerCase() ||
      connection.chainId !== current.chainId
    ) {
      setReview(null);
      setStatus({
        kind: "error",
        message: "The authenticated wallet context changed. Prepare a new exact review.",
      });
      return null;
    }

    let pendingAttempt: ExactActionAttempt | null = null;
    try {
      const accountNonce = await publicClient.getTransactionCount({
        address: connection.address,
        blockTag: "pending",
      });

      const invalidReason = exactActionReviewInvalidReason(current, {
        sender: connection.address,
        chainId: connection.chainId,
        accountNonce,
        nowSeconds: Math.floor(Date.now() / 1000),
        to: current.to,
        data: current.data,
        value: current.value,
      });
      if (invalidReason !== null) {
        setReview(null);
        throw new Error(`${invalidReason} No replacement transaction was generated.`);
      }

      await publicClient.call({
        account: connection.address,
        to: current.to,
        data: current.data,
        value: current.value,
      });

      pendingAttempt = createExactActionAttempt(current, null);
      persistAttempt(pendingAttempt);
      setReview(null);
      setStatus({
        kind: "wallet",
        message:
          "Review the exact destination, nonce, native value and calldata in your wallet. Confirm only after external authorization.",
      });

      const hash = await sendMutation.mutateAsync({
        to: current.to,
        data: current.data,
        value: current.value,
        nonce: current.accountNonce,
      });

      const submitted = withExactActionHash(pendingAttempt, hash);
      pendingAttempt = submitted;
      persistAttempt(submitted);
      setStatus({
        kind: "blocked",
        hash,
        message:
          "The exact transaction hash is preserved while Veilpot waits for conclusive reconciliation. Do not submit another transaction for this action.",
      });

      await publicClient.waitForTransactionReceipt({ hash });
      await verifySubmitted(submitted, hash);
      return hash;
    } catch (error: unknown) {
      if (
        pendingAttempt !== null &&
        pendingAttempt.hash === null &&
        isExplicitWalletRejection(error)
      ) {
        clearAttempt();
        setStatus({
          kind: "idle",
        });
      } else if (pendingAttempt !== null) {
        setStatus({
          kind: "blocked",
          ...(pendingAttempt.hash === null ? {} : { hash: pendingAttempt.hash }),
          message:
            pendingAttempt.hash === null
              ? "The wallet attempt returned no conclusive hash. The exact reviewed nonce and calldata remain blocked. Reconcile before any retry."
              : "The transaction may be submitted or mined. Keep this exact attempt blocked until reconciliation. " +
                errorMessage(error),
        });
      } else {
        setStatus({ kind: "error", message: errorMessage(error) });
      }
      return null;
    }
  }, [
    attempt,
    authenticatedAddress,
    clearAttempt,
    connection,
    persistAttempt,
    publicClient,
    review,
    scope,
    sendMutation,
    storageReady,
    verifySubmitted,
  ]);

  const reconcile = useCallback(async (): Promise<boolean> => {
    const record = attempt;
    if (record === null || publicClient === undefined || !storageReady) return false;
    if (
      connection.status !== "connected" ||
      connection.address.toLowerCase() !== record.sender.toLowerCase() ||
      connection.chainId !== record.chainId
    ) {
      setStatus({
        kind: "blocked",
        ...(record.hash === null ? {} : { hash: record.hash }),
        message:
          "Reconnect the exact authenticated wallet on Ethereum Sepolia before reconciliation.",
      });
      return false;
    }

    try {
      if (record.hash !== null) {
        return await verifySubmitted(record, record.hash);
      }

      const readNonces = async () =>
        Promise.all([
          publicClient.getTransactionCount({ address: record.sender, blockTag: "latest" }),
          publicClient.getTransactionCount({ address: record.sender, blockTag: "pending" }),
        ]);

      const [latestFirst, pendingFirst] = await readNonces();
      await new Promise((resolve) => window.setTimeout(resolve, 1_200));
      const [latestSecond, pendingSecond] = await readNonces();

      if (
        latestFirst === record.accountNonce &&
        pendingFirst === record.accountNonce &&
        latestSecond === record.accountNonce &&
        pendingSecond === record.accountNonce
      ) {
        setStatus({
          kind: "blocked",
          message:
            "No transaction hash was returned and the reviewed nonce currently appears unused, but RPC nonce checks cannot prove that the wallet did not broadcast elsewhere. Keep this attempt blocked unless the original wallet request was explicitly rejected.",
        });
        return false;
      }

      if (pendingSecond > record.accountNonce && latestSecond <= record.accountNonce) {
        setStatus({
          kind: "blocked",
          message:
            "The reviewed nonce appears pending but no hash was returned. Keep this attempt blocked.",
        });
        return false;
      }

      if (latestSecond > record.accountNonce) {
        const latestBlock = await publicClient.getBlockNumber();
        const earliest = latestBlock > 128n ? latestBlock - 128n : 0n;

        for (let blockNumber = latestBlock; blockNumber >= earliest; blockNumber -= 1n) {
          const block = await publicClient.getBlock({
            blockNumber,
            includeTransactions: true,
          });
          const match = block.transactions.find(
            (candidate) =>
              typeof candidate !== "string" &&
              candidate.from.toLowerCase() === record.sender.toLowerCase() &&
              candidate.nonce === record.accountNonce,
          );

          if (match !== undefined && typeof match !== "string") {
            const invalidReason = exactActionTransactionInvalidReason(record, {
              from: match.from,
              to: match.to,
              input: match.input,
              nonce: match.nonce,
              value: match.value,
            });
            if (invalidReason !== null) {
              setStatus({
                kind: "blocked",
                message:
                  `The reviewed nonce was consumed by a different transaction. ${invalidReason} ` +
                  "Keep this record blocked for manual review.",
              });
              return false;
            }

            const submitted = withExactActionHash(record, match.hash);
            persistAttempt(submitted);
            return await verifySubmitted(submitted, match.hash);
          }

          if (blockNumber === 0n) break;
        }

        setStatus({
          kind: "blocked",
          message:
            "The reviewed nonce was consumed, but the exact transaction could not be located in the recent block window. Keep this record blocked.",
        });
        return false;
      }

      setStatus({
        kind: "blocked",
        message: "The wallet attempt is not conclusive. Do not retry it yet.",
      });
      return false;
    } catch (error: unknown) {
      setStatus({
        kind: "blocked",
        ...(record.hash === null ? {} : { hash: record.hash }),
        message:
          "Exact reconciliation was not conclusive. Do not retry automatically. " +
          errorMessage(error),
      });
      return false;
    }
  }, [
    attempt,
    clearAttempt,
    connection,
    persistAttempt,
    publicClient,
    storageReady,
    verifySubmitted,
  ]);

  const discardReview = useCallback(() => {
    if (attempt !== null) return;
    setReview(null);
    setStatus({ kind: "idle" });
  }, [attempt]);

  return {
    review,
    attempt,
    status,
    storageReady,
    isWalletPending: sendMutation.isPending,
    prepare,
    openWallet,
    reconcile,
    discardReview,
  };
}

export function ExactActionReviewCard({
  controller,
  onOpenWallet,
}: {
  readonly controller: ReturnType<typeof useExactAction>;
  readonly onOpenWallet?: () => void | Promise<void>;
}) {
  const { review, attempt, status } = controller;
  const openWalletAction = onOpenWallet ?? controller.openWallet;

  return (
    <div className="financial-plan-review">
      {attempt !== null ? (
        <div className="financial-state-card warning">
          <div>
            <strong>Exact wallet attempt must be reconciled</strong>
            <p>
              {attempt.label} · nonce {attempt.accountNonce}
            </p>
            <span>{attempt.hash ?? "No conclusive transaction hash returned"}</span>
            <button
              className="financial-secondary-button"
              type="button"
              disabled={controller.isWalletPending}
              onClick={() => {
                void controller.reconcile();
              }}
            >
              Reconcile exact wallet attempt
            </button>
          </div>
        </div>
      ) : review !== null ? (
        <>
          <div className="action-review-table">
            <div>
              <span>Action</span>
              <strong>{review.label}</strong>
            </div>
            <div>
              <span>Sender</span>
              <strong>{review.sender}</strong>
            </div>
            <div>
              <span>Destination</span>
              <strong>{review.to}</strong>
            </div>
            <div>
              <span>Wallet nonce</span>
              <strong>{review.accountNonce}</strong>
            </div>
            <div>
              <span>Network</span>
              <strong>Ethereum Sepolia · {review.chainId}</strong>
            </div>
            <div>
              <span>Native value</span>
              <strong>{review.value.toString()} wei</strong>
            </div>
            <div>
              <span>Consequence</span>
              <strong>{review.consequence}</strong>
            </div>
            <div>
              <span>Simulation</span>
              <strong>PASS · exact raw call</strong>
            </div>
            <div>
              <span>Exact calldata</span>
              <strong>{review.data}</strong>
            </div>
          </div>
          <button
            className="financial-primary-button"
            type="button"
            disabled={controller.isWalletPending}
            onClick={() => {
              void openWalletAction();
            }}
          >
            Open exact wallet review
          </button>
        </>
      ) : null}

      {status.kind !== "idle" ? (
        <div
          className={
            status.kind === "included"
              ? "financial-transaction-status success"
              : status.kind === "ready" || status.kind === "wallet"
                ? "financial-transaction-status"
                : "financial-transaction-status error"
          }
        >
          <div>
            <strong>
              {status.kind === "included"
                ? "Exact transaction included"
                : status.kind === "reverted"
                  ? "Exact transaction reverted"
                  : status.kind === "blocked"
                    ? "Exact action blocked pending reconciliation"
                    : status.kind === "ready"
                      ? "Exact review ready"
                      : status.kind === "wallet"
                        ? "Wallet review open"
                        : "Action stopped safely"}
            </strong>
            <p>{status.message}</p>
            {"hash" in status && status.hash !== undefined ? (
              <a
                href={`https://sepolia.etherscan.io/tx/${status.hash}`}
                target="_blank"
                rel="noreferrer"
              >
                View exact transaction
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
