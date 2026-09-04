"use client";

import {
  CheckCircle2,
  Copy,
  ExternalLink,
  KeyRound,
  Laptop,
  LockKeyhole,
  LogOut,
  Network,
  RefreshCw,
  ShieldCheck,
  WalletCards,
  X,
} from "lucide-react";
import { useState } from "react";
import { useConnection, useDisconnect } from "wagmi";

interface WalletCenterProps {
  readonly open: boolean;
  readonly sessionAddress: `0x${string}`;
  readonly onClose: () => void;
  readonly onSignOut: () => Promise<void>;
  readonly onChangeWallet: () => Promise<void>;
}

function compactAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function WalletCenter({
  open,
  sessionAddress,
  onClose,
  onSignOut,
  onChangeWallet,
}: WalletCenterProps) {
  const connection = useConnection();
  const disconnectMutation = useDisconnect();
  const [copied, setCopied] = useState(false);
  if (!open) return null;

  const connectedAddress = connection.address;
  const connectionMatches = connectedAddress?.toLowerCase() === sessionAddress.toLowerCase();
  const explorer = `https://sepolia.etherscan.io/address/${sessionAddress}`;

  const copy = async () => {
    await navigator.clipboard.writeText(sessionAddress);
    setCopied(true);
    window.setTimeout(() => {
      setCopied(false);
    }, 1400);
  };

  return (
    <div
      className="side-panel-root"
      role="dialog"
      aria-modal="true"
      aria-labelledby="wallet-center-title"
    >
      <button
        className="side-panel-scrim"
        type="button"
        aria-label="Close wallet center"
        onClick={onClose}
      />
      <aside className="side-panel wallet-panel">
        <header className="side-panel-header">
          <div>
            <span className="eyebrow">WALLET & ACCESS</span>
            <h2 id="wallet-center-title">Your connection</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close wallet center"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <section className="wallet-identity-card">
          <div className="wallet-identity-mark">
            <WalletCards size={20} />
          </div>
          <div>
            <span>SESSION WALLET</span>
            <strong>{compactAddress(sessionAddress)}</strong>
            <small>
              {connection.connector?.name ?? "Wallet"} ·{" "}
              {connectionMatches ? "connected" : "session active; reconnect for transactions"}
            </small>
          </div>
          <button
            className="icon-button quiet"
            type="button"
            aria-label="Copy wallet address"
            onClick={() => void copy()}
          >
            {copied ? <CheckCircle2 size={16} /> : <Copy size={16} />}
          </button>
        </section>
        <div className="wallet-health-grid">
          <div>
            <Network size={17} />
            <span>Network</span>
            <strong>
              {connection.chainId === 11155111
                ? "Sepolia"
                : connection.isConnected
                  ? "Wrong network"
                  : "Not connected"}
            </strong>
            <small>Chain 11155111 required</small>
          </div>
          <div>
            <ShieldCheck size={17} />
            <span>Connection</span>
            <strong>{connectionMatches ? "Healthy" : "Reconnect"}</strong>
            <small>
              {connectionMatches ? "Wallet matches session" : "Session remains authenticated"}
            </small>
          </div>
          <div>
            <KeyRound size={17} />
            <span>Session</span>
            <strong>Signed in</strong>
            <small>SIWE authenticated</small>
          </div>
          <div>
            <LockKeyhole size={17} />
            <span>Encryption</span>
            <strong>Explicit only</strong>
            <small>No auto-decrypt</small>
          </div>
        </div>
        <section className="wallet-control-section">
          <header>
            <span>SESSION & DEVICE</span>
          </header>
          <div className="device-row">
            <Laptop size={18} />
            <div>
              <strong>This browser</strong>
              <span>Current wallet-authenticated session</span>
            </div>
            <small>Active now</small>
          </div>
        </section>
        <section className="wallet-control-section">
          <header>
            <span>CONNECTION CONTROLS</span>
          </header>
          <button
            className="wallet-control-row"
            type="button"
            onClick={() => void onChangeWallet()}
          >
            <RefreshCw size={16} />
            <div>
              <strong>Change wallet</strong>
              <span>Sign out, disconnect, and choose another provider</span>
            </div>
          </button>
          <a className="wallet-control-row" href={explorer} target="_blank" rel="noreferrer">
            <ExternalLink size={16} />
            <div>
              <strong>View on explorer</strong>
              <span>Open the session address on Sepolia Etherscan</span>
            </div>
          </a>
        </section>
        <div className="wallet-disclosure">
          <CheckCircle2 size={16} />
          <p>
            Permissionless keepers can execute valid Autopilot windows. They do not receive standing
            wallet authority, withdrawal rights, prize claim rights, or decryption access.
          </p>
        </div>
        <button className="danger-outline-button" type="button" onClick={() => void onSignOut()}>
          <LogOut size={16} /> Sign out of this session
        </button>
        {connection.isConnected ? (
          <button
            className="quiet-disconnect-button"
            type="button"
            onClick={() => {
              disconnectMutation.mutate();
            }}
          >
            Disconnect wallet only
          </button>
        ) : null}
      </aside>
    </div>
  );
}
