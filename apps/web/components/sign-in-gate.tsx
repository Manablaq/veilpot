"use client";

import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronRight,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  ShieldCheck,
  WalletCards,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { getAddress } from "viem";
import { useConnect, useConnection, useConnectors, useSignMessage, useSwitchChain } from "wagmi";
import { sepolia } from "wagmi/chains";

import { NetworkPill, VeilpotMark } from "@/components/brand";
import { ThemeControl } from "@/components/theme-control";
import { buildVeilpotSiweMessage, VEILPOT_CHAIN_ID, VEILPOT_SESSION_TTL_MS } from "@/lib/siwe";

export interface AuthSession {
  readonly address: `0x${string}`;
  readonly chainId: number;
  readonly expiresAt: string;
}

interface SignInGateProps {
  readonly onSignedIn: (session: AuthSession) => void;
}

type SignInStep = "choose" | "connecting" | "network" | "signing" | "verifying";

function readableError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes("user rejected") || message.includes("user denied"))
      return "The wallet request was cancelled. Nothing changed.";
    if (message.includes("chain") && message.includes("switch"))
      return "Veilpot needs Ethereum Sepolia for this testnet session. Switch networks in your wallet and try again.";
    if (message.includes("connector") || message.includes("provider"))
      return "That wallet is not responding. Reopen or unlock it, then try again.";
  }
  return "Veilpot could not complete wallet sign-in. Your funds and private values were not touched.";
}

export function SignInGate({ onSignedIn }: SignInGateProps) {
  const connection = useConnection();
  const connectors = useConnectors();
  const connectMutation = useConnect();
  const connecting = connectMutation.isPending;
  const switchChainMutation = useSwitchChain();
  const signMessageMutation = useSignMessage();

  const [connectOpen, setConnectOpen] = useState(false);
  const [selectedConnectorId, setSelectedConnectorId] = useState<string | null>(null);
  const [step, setStep] = useState<SignInStep>("choose");
  const [error, setError] = useState<string | null>(null);

  const availableConnectors = useMemo(() => {
    const seen = new Set<string>();
    return connectors.filter((connector) => {
      const identity = `${connector.id}:${connector.name}`;
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
  }, [connectors]);

  const selectedConnector =
    availableConnectors.find((connector) => connector.id === selectedConnectorId) ?? null;
  const busy =
    connecting ||
    step === "connecting" ||
    step === "network" ||
    step === "signing" ||
    step === "verifying";

  const close = () => {
    if (busy) return;
    setConnectOpen(false);
    setError(null);
    setStep("choose");
  };

  const signIn = async () => {
    setError(null);
    try {
      let address = connection.address;
      let chainId = connection.chainId;

      if (
        !address ||
        !connection.isConnected ||
        (selectedConnector && connection.connector?.id !== selectedConnector.id)
      ) {
        if (!selectedConnector) throw new Error("No wallet connector selected.");
        setStep("connecting");
        const connected = await connectMutation.mutateAsync({
          connector: selectedConnector,
          chainId: sepolia.id,
        });
        address = connected.accounts[0];
        chainId = connected.chainId;
      }

      if (chainId !== sepolia.id) {
        setStep("network");
        await switchChainMutation.mutateAsync({ chainId: sepolia.id });
      }

      const nonceResponse = await fetch("/api/auth/nonce", {
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!nonceResponse.ok) throw new Error("Could not create sign-in challenge.");
      const nonceBody: unknown = await nonceResponse.json();
      if (
        nonceBody === null ||
        typeof nonceBody !== "object" ||
        !("nonce" in nonceBody) ||
        typeof nonceBody.nonce !== "string"
      ) {
        throw new Error("Invalid sign-in challenge.");
      }
      const nonce = nonceBody.nonce;

      const issuedAt = new Date();
      const expirationTime = new Date(issuedAt.getTime() + VEILPOT_SESSION_TTL_MS);
      const checksumAddress = getAddress(address);
      const message = buildVeilpotSiweMessage({
        domain: window.location.host,
        address: checksumAddress,
        uri: window.location.origin,
        chainId: VEILPOT_CHAIN_ID,
        nonce,
        issuedAt: issuedAt.toISOString(),
        expirationTime: expirationTime.toISOString(),
      });

      setStep("signing");
      const signature = await signMessageMutation.mutateAsync({ message });

      setStep("verifying");
      const verifyResponse = await fetch("/api/auth/verify", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, signature }),
      });
      const verifyBody: unknown = await verifyResponse.json().catch(() => null);

      if (!verifyResponse.ok) {
        const verifyError =
          verifyBody !== null &&
          typeof verifyBody === "object" &&
          "error" in verifyBody &&
          typeof verifyBody.error === "string"
            ? verifyBody.error
            : "Signature verification failed.";
        throw new Error(verifyError);
      }

      if (
        verifyBody === null ||
        typeof verifyBody !== "object" ||
        !("address" in verifyBody) ||
        typeof verifyBody.address !== "string" ||
        !("chainId" in verifyBody) ||
        typeof verifyBody.chainId !== "number" ||
        !("expiresAt" in verifyBody) ||
        typeof verifyBody.expiresAt !== "string"
      ) {
        throw new Error("Veilpot returned an invalid session.");
      }

      const verifiedAddress = getAddress(verifyBody.address);

      setConnectOpen(false);
      setStep("choose");
      onSignedIn({
        address: verifiedAddress,
        chainId: verifyBody.chainId,
        expiresAt: verifyBody.expiresAt,
      });
    } catch (caught) {
      setStep("choose");
      setError(readableError(caught));
    }
  };

  return (
    <main className="signin-page">
      <header className="signin-header">
        <VeilpotMark />
        <div className="signin-header-actions">
          <ThemeControl compact />
          <span className="testnet-label">TESTNET</span>
          <NetworkPill />
        </div>
      </header>

      <section className="signin-shell">
        <div className="signin-copy">
          <span className="eyebrow">PRIVATE SAVINGS, WITHOUT THE PUBLIC SPREADSHEET</span>
          <h1>A calmer way to save onchain.</h1>
          <p>
            Create private saving plans, automate exact contribution windows, and keep VeilDraw
            outcomes private until you choose to reveal them.
          </p>

          <div className="signin-trust-list">
            <div>
              <ShieldCheck size={18} />
              <span>
                <strong>You approve every consequential wallet action.</strong> No hidden signing
                and no standing keeper custody.
              </span>
            </div>
            <div>
              <LockKeyhole size={18} />
              <span>
                <strong>Private values stay private by default.</strong> Reveal is always explicit
                and scoped.
              </span>
            </div>
            <div>
              <KeyRound size={18} />
              <span>
                <strong>Your wallet is the account authority.</strong> Sign-in uses an expiring
                EIP-4361 message and never moves funds.
              </span>
            </div>
          </div>

          <button
            className="signin-primary"
            type="button"
            onClick={() => {
              setConnectOpen(true);
            }}
          >
            Sign in with wallet <ArrowRight size={17} />
          </button>
          <p className="signin-footnote">
            Connection, EIP-4361 sign-in, transaction approval, and private reveal remain separate
            actions.
          </p>
        </div>

        <aside className="signin-receipt" aria-label="What happens when you sign in">
          <div className="signin-receipt-head">
            <span>WHAT YOU ARE SIGNING INTO</span>
            <span className="receipt-status">
              <i /> Ready
            </span>
          </div>
          <h2>Your private Veilpot account</h2>
          <p>
            One wallet-authenticated session for your plans, portfolio, notifications, wallet
            controls, privacy settings, and support history.
          </p>
          <div className="signin-receipt-rows">
            <div>
              <span>Network</span>
              <strong>Ethereum Sepolia</strong>
            </div>
            <div>
              <span>Session</span>
              <strong>4-hour SIWE session</strong>
            </div>
            <div>
              <span>Balance visibility</span>
              <strong>Hidden by default</strong>
            </div>
            <div>
              <span>Automatic decryption</span>
              <strong>Never</strong>
            </div>
          </div>
          <div className="signin-receipt-note">
            <ShieldCheck size={17} />
            <p>
              <strong>Before you sign, read the wallet message.</strong> It is bound to this origin,
              your address, Sepolia, a one-time nonce, and an expiry.
            </p>
          </div>
        </aside>
      </section>

      <footer className="signin-footer">
        <span>Veilpot · Sepolia</span>
        <nav aria-label="Support links">
          <a href="/#trust">Trust</a>
          <a href="/#privacy">Privacy</a>
          <a href="/#help">Help</a>
          <a href="/#terms">Terms</a>
        </nav>
      </footer>

      {connectOpen ? (
        <div
          className="wallet-dialog-root"
          role="dialog"
          aria-modal="true"
          aria-labelledby="wallet-dialog-title"
        >
          <button
            className="wallet-dialog-scrim"
            type="button"
            aria-label="Close wallet chooser"
            onClick={close}
          />
          <section className="wallet-dialog">
            <header>
              <div>
                <span className="eyebrow">SIGN IN</span>
                <h2 id="wallet-dialog-title">Choose your wallet</h2>
              </div>
              <button
                className="icon-button"
                type="button"
                aria-label="Close wallet chooser"
                disabled={busy}
                onClick={close}
              >
                <X size={18} />
              </button>
            </header>

            <div className="wallet-choice-list">
              {availableConnectors.length === 0 ? (
                <div className="wallet-empty-state">
                  <WalletCards size={22} />
                  <strong>No compatible browser wallet detected</strong>
                  <span>
                    Install or unlock an EIP-6963 compatible Ethereum wallet, then refresh this
                    page.
                  </span>
                </div>
              ) : (
                availableConnectors.map((connector) => (
                  <button
                    className={
                      selectedConnectorId === connector.id
                        ? "wallet-choice selected"
                        : "wallet-choice"
                    }
                    type="button"
                    key={`${connector.id}:${connector.name}`}
                    disabled={busy}
                    onClick={() => {
                      setSelectedConnectorId(connector.id);
                    }}
                  >
                    <span className="wallet-choice-icon">
                      <WalletCards size={19} />
                    </span>
                    <span className="wallet-choice-copy">
                      <strong>{connector.name}</strong>
                      <small>EIP-6963 compatible provider</small>
                    </span>
                    <span className="wallet-choice-tag">Detected</span>
                    {selectedConnectorId === connector.id ? (
                      <Check size={17} />
                    ) : (
                      <ChevronRight size={17} />
                    )}
                  </button>
                ))
              )}
            </div>

            {error ? (
              <div className="wallet-error">
                <AlertTriangle size={16} />
                <span>{error}</span>
              </div>
            ) : null}
            <div className="wallet-dialog-safety">
              <LockKeyhole size={16} />
              <span>
                Signing in authenticates your session. It cannot transfer tokens, create a pot, or
                reveal a confidential value.
              </span>
            </div>

            <button
              className="wallet-continue"
              type="button"
              disabled={selectedConnector === null || busy}
              onClick={() => void signIn()}
            >
              {busy ? (
                <>
                  <LoaderCircle className="spin" size={16} />{" "}
                  {step === "signing"
                    ? "Check your wallet"
                    : step === "verifying"
                      ? "Verifying signature"
                      : step === "network"
                        ? "Switching to Sepolia"
                        : "Connecting"}
                </>
              ) : (
                <>
                  Connect and sign in <ArrowRight size={16} />
                </>
              )}
            </button>
          </section>
        </div>
      ) : null}
    </main>
  );
}
