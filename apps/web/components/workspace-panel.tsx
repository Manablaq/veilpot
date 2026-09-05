"use client";

import {
  Activity,
  Bell,
  BookOpen,
  CalendarClock,
  ChevronRight,
  FileText,
  HelpCircle,
  LockKeyhole,
  Plus,
  Settings,
  ShieldCheck,
  WalletCards,
} from "lucide-react";

import type { Address } from "viem";

import { AutopilotControlCenter } from "@/components/autopilot-control-center";
import { DrawControlCenter } from "@/components/draw-control-center";
import { LiveAccountOverview } from "@/components/live-account-overview";
import { LiveActivityPanel } from "@/components/live-activity-panel";
import { PrizeControlCenter } from "@/components/prize-control-center";
import { ThemeControl } from "@/components/theme-control";
import { PRODUCT } from "@/lib/product";

export type WorkspaceView =
  | "home"
  | "pots"
  | "autopilot"
  | "draws"
  | "portfolio"
  | "activity"
  | "statements"
  | "privacy"
  | "trust"
  | "help"
  | "settings";

interface WorkspacePanelProps {
  readonly authenticatedAddress: Address;
  readonly view: Exclude<WorkspaceView, "home">;
  readonly onNavigate: (view: WorkspaceView) => void;
  readonly onNewPot: () => void;
  readonly onOpenWallet: () => void;
  readonly onOpenNotifications: () => void;
  readonly onTogglePrivacy: () => void;
  readonly privacyShield: boolean;
}

const titles: Record<Exclude<WorkspaceView, "home">, readonly [string, string]> = {
  pots: [
    "Saving pots",
    "Live public account state appears first. Any illustrative planning layouts below remain explicitly non-authoritative.",
  ],
  autopilot: [
    "Autopilot",
    "Protocol controls and schedule concepts. No live plan is assumed until protocol state is read.",
  ],
  draws: [
    "VeilDraw",
    "Live snapshot, draw, public-proof, PrizeReserve, and claim controls. Private winner and amount data stay encrypted unless explicitly authorized.",
  ],
  portfolio: [
    "Portfolio",
    "Confidential values stay encrypted. This view never invents balances, allocation, or wallet history.",
  ],
  activity: [
    "Activity",
    "Recent public Sepolia account events are loaded from protocol contracts; confidential values are never inferred.",
  ],
  statements: ["Statements", "Account records prepared for review and export."],
  privacy: [
    "Privacy center",
    "Control what is hidden, what you reveal, and what notifications can disclose.",
  ],
  trust: [
    "Trust & security",
    "Inspect network, contracts, authority boundaries, and recovery assumptions.",
  ],
  help: [
    "Help center",
    "Understand Veilpot, fix common wallet issues, and find safe next actions.",
  ],
  settings: [
    "Settings",
    "Appearance, privacy defaults, notifications, accessibility, and expert controls.",
  ],
};

export function WorkspacePanel({
  authenticatedAddress,
  view,
  onNavigate,
  onNewPot,
  onOpenWallet,
  onOpenNotifications,
  onTogglePrivacy,
  privacyShield,
}: WorkspacePanelProps) {
  const [title, description] = titles[view];

  return (
    <section className="workspace-view" aria-labelledby="workspace-title">
      <header className="workspace-view-header">
        <div>
          <span className="eyebrow">YOUR VEILPOT</span>
          <h1 id="workspace-title">{title}</h1>
          <p>{description}</p>
        </div>
        {view === "pots" ? (
          <button className="primary-button" type="button" onClick={onNewPot}>
            <Plus size={16} /> New saving pot
          </button>
        ) : null}
      </header>

      {view === "pots" ? <LiveAccountOverview authenticatedAddress={authenticatedAddress} /> : null}

      {view === "autopilot" ? (
        <AutopilotControlCenter authenticatedAddress={authenticatedAddress} />
      ) : null}

      {view === "draws" ? (
        <>
          <DrawControlCenter authenticatedAddress={authenticatedAddress} />
          <PrizeControlCenter authenticatedAddress={authenticatedAddress} />
        </>
      ) : null}

      {view === "portfolio" ? (
        <LiveAccountOverview authenticatedAddress={authenticatedAddress} />
      ) : null}

      {view === "portfolio" ? (
        <div className="workspace-grid two">
          <article className="workspace-card block private-surface">
            <span className="eyebrow">PRIVATE PORTFOLIO</span>
            <div className="private-account-placeholder" role="status">
              <div className="privacy-value-toolbar">
                <span>
                  <LockKeyhole size={13} /> Encrypted on-chain
                </span>
              </div>
              <div className="privacy-value-display masked">
                <div className="privacy-mask-line" aria-hidden="true">
                  <span>Private</span>
                  <i />
                  <i />
                  <i />
                </div>
              </div>
              <p className="financial-field-help">
                Pool principal is intentionally not decrypted by this account view. This deployment
                keeps the principal handle contract-private and supports confidential spending and
                withdrawal without a fake presentation reveal.
              </p>
            </div>
            <div className="portfolio-facts">
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
          </article>
          <article className="workspace-card block">
            <Activity size={20} />
            <span className="eyebrow">ACCOUNT HEALTH</span>
            <h2>Protocol-aware</h2>
            <dl>
              <div>
                <dt>Wallet session</dt>
                <dd>Verified</dd>
              </div>
              <div>
                <dt>Pending actions</dt>
                <dd>Read on demand</dd>
              </div>
              <div>
                <dt>Privacy default</dt>
                <dd>{privacyShield ? "Shield on" : "Visible where revealed"}</dd>
              </div>
            </dl>
          </article>
        </div>
      ) : null}

      {view === "activity" ? (
        <LiveActivityPanel authenticatedAddress={authenticatedAddress} />
      ) : null}

      {view === "statements" ? (
        <div className="workspace-grid two">
          <article className="workspace-card block">
            <FileText size={20} />
            <span className="eyebrow">MONTHLY RECORD</span>
            <h2>September 2026</h2>
            <p>
              Statements will contain account events and public transaction references without
              silently exporting confidential values.
            </p>
            <button
              type="button"
              onClick={() => {
                window.print();
              }}
            >
              Print current account view
            </button>
          </article>
          <article className="workspace-card block">
            <ShieldCheck size={20} />
            <span className="eyebrow">EXPORT PRIVACY</span>
            <h2>Private by design</h2>
            <p>
              Any future CSV/PDF export that includes revealed confidential data will require an
              explicit disclosure step.
            </p>
          </article>
        </div>
      ) : null}

      {view === "privacy" ? (
        <div className="workspace-grid two">
          <article className="workspace-card block">
            <LockKeyhole size={20} />
            <span className="eyebrow">PRIVACY SHIELD</span>
            <h2>
              {privacyShield ? "Private values are hidden" : "Revealed values may be visible"}
            </h2>
            <p>
              Privacy Shield changes presentation only. It never performs blockchain decryption.
            </p>
            <button type="button" onClick={onTogglePrivacy}>
              {privacyShield ? "Turn shield off" : "Hide private values"}
            </button>
          </article>
          <article className="workspace-card block">
            <Bell size={20} />
            <span className="eyebrow">NOTIFICATIONS</span>
            <h2>Private wording</h2>
            <p>
              Lock-screen style notifications avoid balances, contribution amounts, and private draw
              outcomes.
            </p>
            <button type="button" onClick={onOpenNotifications}>
              Open notifications <ChevronRight size={15} />
            </button>
          </article>
        </div>
      ) : null}

      {view === "trust" ? (
        <div className="workspace-grid two">
          <article className="workspace-card block">
            <ShieldCheck size={20} />
            <span className="eyebrow">CURRENT DEPLOYMENT</span>
            <h2>Ethereum Sepolia</h2>
            <dl>
              <div>
                <dt>Chain</dt>
                <dd>11155111</dd>
              </div>
              <div>
                <dt>Pool</dt>
                <dd>
                  <code>{PRODUCT.deployment.pool}</code>
                </dd>
              </div>
              <div>
                <dt>Vault</dt>
                <dd>
                  <code>{PRODUCT.deployment.vault}</code>
                </dd>
              </div>
            </dl>
          </article>
          <article className="workspace-card block">
            <WalletCards size={20} />
            <span className="eyebrow">AUTHORITY</span>
            <h2>Your wallet stays consequential.</h2>
            <p>
              Sign-in does not grant keeper withdrawal, claim, recipient-selection, or decryption
              rights.
            </p>
            <button type="button" onClick={onOpenWallet}>
              Wallet & access <ChevronRight size={15} />
            </button>
          </article>
        </div>
      ) : null}

      {view === "help" ? (
        <div className="workspace-grid three">
          <button
            className="workspace-card support-card"
            type="button"
            onClick={() => {
              onNavigate("pots");
            }}
          >
            <BookOpen size={20} />
            <strong>Saving pots</strong>
            <span>Understand schedules, goals, and progress.</span>
          </button>
          <button
            className="workspace-card support-card"
            type="button"
            onClick={() => {
              onNavigate("autopilot");
            }}
          >
            <CalendarClock size={20} />
            <strong>Autopilot</strong>
            <span>Windows, funding, pause, skip, and revoke.</span>
          </button>
          <button className="workspace-card support-card" type="button" onClick={onOpenWallet}>
            <WalletCards size={20} />
            <strong>Wallet help</strong>
            <span>Connection, network, sessions, and switching.</span>
          </button>
          <button
            className="workspace-card support-card"
            type="button"
            onClick={() => {
              onNavigate("privacy");
            }}
          >
            <LockKeyhole size={20} />
            <strong>Privacy</strong>
            <span>Reveal controls and safe notifications.</span>
          </button>
          <button
            className="workspace-card support-card"
            type="button"
            onClick={() => {
              onNavigate("trust");
            }}
          >
            <ShieldCheck size={20} />
            <strong>Trust center</strong>
            <span>Contracts and testnet disclosures.</span>
          </button>
          <a className="workspace-card support-card" href="mailto:support@veilpot.app">
            <HelpCircle size={20} />
            <strong>Contact support</strong>
            <span>Open your email client.</span>
          </a>
        </div>
      ) : null}

      {view === "settings" ? (
        <div className="workspace-grid two">
          <article className="workspace-card block">
            <Settings size={20} />
            <span className="eyebrow">APPEARANCE</span>
            <h2>Light, dark, or system.</h2>
            <p>Your preference is stored locally on this device and updates immediately.</p>
            <ThemeControl />
          </article>
          <article className="workspace-card block">
            <LockKeyhole size={20} />
            <span className="eyebrow">PRIVACY DEFAULT</span>
            <h2>{privacyShield ? "Hide on load" : "Current session visible"}</h2>
            <p>Use Privacy Shield whenever you want to conceal revealed values quickly.</p>
            <button type="button" onClick={onTogglePrivacy}>
              {privacyShield ? "Change for this session" : "Hide private values now"}
            </button>
          </article>
        </div>
      ) : null}
    </section>
  );
}
