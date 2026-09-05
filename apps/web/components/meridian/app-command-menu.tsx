"use client";

import { Search, WalletCards, X } from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import styles from "@/app/meridian-app.module.css";
import { MERIDIAN_NAV_ITEMS, type MeridianView } from "@/components/meridian/app-navigation";

interface MeridianCommandMenuProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onNavigate: (view: MeridianView) => void;
  readonly onOpenWallet: () => void;
}

function focusableElements(root: HTMLElement): readonly HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'input, button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
    ),
  );
}

export function MeridianCommandMenu({
  open,
  onClose,
  onNavigate,
  onOpenWallet,
}: MeridianCommandMenuProps) {
  const [query, setQuery] = useState("");
  const panelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      setQuery("");
    }
  }, [open]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();

    if (normalized.length === 0) {
      return MERIDIAN_NAV_ITEMS;
    }

    return MERIDIAN_NAV_ITEMS.filter((item) =>
      `${item.label} ${item.description}`.toLowerCase().includes(normalized),
    );
  }, [query]);

  const trapFocus = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;

    const panel = panelRef.current;
    if (panel === null) return;

    const focusable = focusableElements(panel);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
      return;
    }

    if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!open) return null;

  return (
    <div
      className={styles.commandRoot}
      role="dialog"
      aria-modal="true"
      aria-labelledby="meridian-command-title"
    >
      <button
        className={styles.commandScrim}
        type="button"
        aria-label="Close command menu"
        onClick={onClose}
      />

      <section ref={panelRef} className={styles.commandMenu} onKeyDown={trapFocus}>
        <header className={styles.commandHeader}>
          <Search size={17} aria-hidden="true" />

          <input
            autoFocus
            value={query}
            aria-label="Search Veilpot"
            placeholder="Search Veilpot"
            onChange={(event) => {
              setQuery(event.target.value);
            }}
          />

          <kbd>⌘K</kbd>

          <button type="button" aria-label="Close command menu" onClick={onClose}>
            <X size={16} aria-hidden="true" />
          </button>
        </header>

        <div className={styles.commandBody}>
          <span id="meridian-command-title" className={styles.commandSectionLabel}>
            NAVIGATE
          </span>

          <div className={styles.commandResults}>
            {filtered.map((item) => {
              const Icon = item.icon;

              return (
                <button
                  key={item.view}
                  type="button"
                  onClick={() => {
                    onNavigate(item.view);
                    onClose();
                  }}
                >
                  <Icon size={17} aria-hidden="true" />

                  <span>
                    <strong>{item.label}</strong>
                    <small>{item.description}</small>
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
              <WalletCards size={17} aria-hidden="true" />

              <span>
                <strong>Wallet & access</strong>
                <small>Session, connection, network and explorer</small>
              </span>
            </button>

            {filtered.length === 0 ? (
              <p className={styles.commandEmpty}>No matching Veilpot section.</p>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}
