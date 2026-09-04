"use client";

import {
  Activity,
  BookOpen,
  CalendarClock,
  FileText,
  Gift,
  Home,
  LockKeyhole,
  Settings,
  ShieldCheck,
  Vault,
  WalletCards,
  X,
} from "lucide-react";

import type { WorkspaceView } from "@/components/workspace-panel";

interface MobileDrawerProps {
  readonly open: boolean;
  readonly active: WorkspaceView;
  readonly onClose: () => void;
  readonly onNavigate: (view: WorkspaceView) => void;
  readonly onOpenWallet: () => void;
}

const items = [
  ["home", "Home", Home],
  ["pots", "Pots", Vault],
  ["autopilot", "Autopilot", CalendarClock],
  ["draws", "Draws", Gift],
  ["portfolio", "Portfolio", Activity],
  ["activity", "Activity", Activity],
  ["statements", "Statements", FileText],
  ["privacy", "Privacy", LockKeyhole],
  ["trust", "Trust & security", ShieldCheck],
  ["help", "Help", BookOpen],
  ["settings", "Settings", Settings],
] as const;

export function MobileDrawer({
  open,
  active,
  onClose,
  onNavigate,
  onOpenWallet,
}: MobileDrawerProps) {
  if (!open) return null;
  return (
    <div className="mobile-drawer-root" role="dialog" aria-modal="true" aria-label="Navigation">
      <button
        className="mobile-drawer-scrim"
        type="button"
        aria-label="Close navigation"
        onClick={onClose}
      />
      <aside className="mobile-drawer">
        <header>
          <strong>Navigate</strong>
          <button type="button" aria-label="Close navigation" onClick={onClose}>
            <X size={18} />
          </button>
        </header>
        <nav>
          {items.map(([view, label, Icon]) => (
            <button
              key={view}
              className={active === view ? "active" : ""}
              type="button"
              onClick={() => {
                onNavigate(view);
                onClose();
              }}
            >
              <Icon size={17} /> {label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              onOpenWallet();
              onClose();
            }}
          >
            <WalletCards size={17} /> Wallet & access
          </button>
        </nav>
      </aside>
    </div>
  );
}
