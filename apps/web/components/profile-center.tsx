"use client";

import {
  Activity,
  CalendarDays,
  ChevronRight,
  FileText,
  LockKeyhole,
  Settings,
  ShieldCheck,
  UserRound,
  WalletCards,
  X,
} from "lucide-react";

import { PrivacyValue } from "@/components/privacy-value";
import type { WorkspaceView } from "@/components/workspace-panel";

interface ProfileCenterProps {
  readonly open: boolean;
  readonly address: `0x${string}`;
  readonly onClose: () => void;
  readonly onOpenWallet: () => void;
  readonly onNavigate: (view: WorkspaceView) => void;
}

function compactAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function ProfileCenter({
  open,
  address,
  onClose,
  onOpenWallet,
  onNavigate,
}: ProfileCenterProps) {
  if (!open) return null;
  const navigate = (view: WorkspaceView) => {
    onNavigate(view);
    onClose();
  };

  return (
    <div
      className="side-panel-root"
      role="dialog"
      aria-modal="true"
      aria-labelledby="profile-title"
    >
      <button
        className="side-panel-scrim"
        type="button"
        aria-label="Close profile"
        onClick={onClose}
      />
      <aside className="side-panel profile-panel">
        <header className="side-panel-header">
          <div>
            <span className="eyebrow">YOUR ACCOUNT</span>
            <h2 id="profile-title">Profile & portfolio</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            aria-label="Close profile"
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <section className="profile-identity">
          <div className="profile-avatar">
            <UserRound size={23} />
          </div>
          <div>
            <strong>Primary Veilpot account</strong>
            <span>{compactAddress(address)} · Sepolia session</span>
          </div>
          <span className="verified-pill">
            <ShieldCheck size={13} /> Session verified
          </span>
        </section>
        <section className="profile-portfolio-card">
          <header>
            <span>PRIVATE PORTFOLIO</span>
            <LockKeyhole size={15} />
          </header>
          <PrivacyValue value="Not decrypted" label="confidential savings value" large />
          <div className="profile-portfolio-stats">
            <div>
              <span>Active pots</span>
              <strong>—</strong>
            </div>
            <div>
              <span>Funded windows</span>
              <strong>—</strong>
            </div>
            <div>
              <span>Draws entered</span>
              <strong>—</strong>
            </div>
          </div>
        </section>
        <section className="profile-progress-section">
          <header>
            <span>ACCOUNT HEALTH</span>
            <small>Privacy-first</small>
          </header>
          <div className="health-row">
            <span>Wallet session</span>
            <strong>Verified</strong>
          </div>
          <div className="health-row">
            <span>Autopilot funding runway</span>
            <strong>Not inferred</strong>
          </div>
          <div className="health-row">
            <span>Privacy default</span>
            <strong>Hide on load</strong>
          </div>
          <div className="health-row">
            <span>Pending actions</span>
            <strong>Read on demand</strong>
          </div>
        </section>
        <nav className="profile-menu" aria-label="Profile sections">
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenWallet();
            }}
          >
            <WalletCards size={17} />
            <span>
              <strong>Wallet & access</strong>
              <small>Connection, sessions, devices</small>
            </span>
            <ChevronRight size={16} />
          </button>
          <button
            type="button"
            onClick={() => {
              navigate("activity");
            }}
          >
            <Activity size={17} />
            <span>
              <strong>Activity</strong>
              <small>Transactions, plans, draws</small>
            </span>
            <ChevronRight size={16} />
          </button>
          <button
            type="button"
            onClick={() => {
              navigate("pots");
            }}
          >
            <CalendarDays size={17} />
            <span>
              <strong>Plan history</strong>
              <small>Schedules, pauses, skips, revocations</small>
            </span>
            <ChevronRight size={16} />
          </button>
          <button
            type="button"
            onClick={() => {
              navigate("statements");
            }}
          >
            <FileText size={17} />
            <span>
              <strong>Documents</strong>
              <small>Statements and account records</small>
            </span>
            <ChevronRight size={16} />
          </button>
          <button
            type="button"
            onClick={() => {
              navigate("settings");
            }}
          >
            <Settings size={17} />
            <span>
              <strong>Preferences</strong>
              <small>Privacy, notifications, accessibility</small>
            </span>
            <ChevronRight size={16} />
          </button>
        </nav>
      </aside>
    </div>
  );
}
