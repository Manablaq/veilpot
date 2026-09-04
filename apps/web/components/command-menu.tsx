"use client";

import {
  Activity,
  CalendarClock,
  Gift,
  LockKeyhole,
  Search,
  Settings,
  ShieldCheck,
  Vault,
  WalletCards,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { WorkspaceView } from "@/components/workspace-panel";

interface CommandMenuProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onNavigate: (view: WorkspaceView) => void;
  readonly onOpenWallet: () => void;
}

const commands = [
  { label: "Saving pots", detail: "Goals and schedules", view: "pots" as const, icon: Vault },
  {
    label: "Autopilot",
    detail: "Windows and runway",
    view: "autopilot" as const,
    icon: CalendarClock,
  },
  { label: "VeilDraw", detail: "Draw lifecycle", view: "draws" as const, icon: Gift },
  {
    label: "Portfolio",
    detail: "Private account overview",
    view: "portfolio" as const,
    icon: Activity,
  },
  {
    label: "Privacy center",
    detail: "Reveal and notification controls",
    view: "privacy" as const,
    icon: LockKeyhole,
  },
  {
    label: "Trust & security",
    detail: "Contracts and boundaries",
    view: "trust" as const,
    icon: ShieldCheck,
  },
  {
    label: "Settings",
    detail: "Appearance and preferences",
    view: "settings" as const,
    icon: Settings,
  },
] as const;

export function CommandMenu({ open, onClose, onNavigate, onOpenWallet }: CommandMenuProps) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return commands;
    return commands.filter((command) =>
      `${command.label} ${command.detail}`.toLowerCase().includes(normalized),
    );
  }, [query]);

  if (!open) return null;

  return (
    <div className="command-root" role="dialog" aria-modal="true" aria-label="Search Veilpot">
      <button className="command-scrim" type="button" aria-label="Close search" onClick={onClose} />
      <section className="command-menu">
        <header>
          <Search size={18} />
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            placeholder="Search Veilpot"
            aria-label="Search Veilpot"
          />
          <button type="button" aria-label="Close search" onClick={onClose}>
            <X size={17} />
          </button>
        </header>
        <div className="command-results">
          {filtered.map((command) => {
            const Icon = command.icon;
            return (
              <button
                type="button"
                key={command.view}
                onClick={() => {
                  onNavigate(command.view);
                  onClose();
                }}
              >
                <Icon size={17} />
                <span>
                  <strong>{command.label}</strong>
                  <small>{command.detail}</small>
                </span>
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => {
              onOpenWallet();
              onClose();
            }}
          >
            <WalletCards size={17} />
            <span>
              <strong>Wallet & access</strong>
              <small>Connection, address, session, explorer</small>
            </span>
          </button>
          {filtered.length === 0 ? (
            <p className="command-empty">No matching Veilpot section.</p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
