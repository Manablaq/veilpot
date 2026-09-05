"use client";

import {
  Bell,
  ChevronLeft,
  ChevronRight,
  Command,
  LockKeyhole,
  Menu,
  Search,
  ShieldAlert,
  UserRound,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getAddress } from "viem";
import { useConnection, useDisconnect } from "wagmi";

import { VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT } from "@veilpot/protocol-sdk";

import styles from "@/app/meridian-app.module.css";
import { VeilpotMark } from "@/components/brand";
import { MeridianCommandMenu } from "@/components/meridian/app-command-menu";
import {
  MERIDIAN_NAV_ITEMS,
  meridianNavigationItem,
  type MeridianView,
} from "@/components/meridian/app-navigation";
import { MeridianWorkspace } from "@/components/meridian/app-workspace";
import { ProtocolBadge } from "@/components/meridian";
import { SignInGate, type AuthSession } from "@/components/sign-in-gate";
import { ThemeControl } from "@/components/theme-control";
import { WalletCenter } from "@/components/wallet-center";

const SESSION_BOOTSTRAP_TIMEOUT_MS = 12_000;

const MOBILE_PRIMARY_VIEWS = [
  "overview",
  "save",
  "autopilot",
  "veildraw",
] as const satisfies readonly MeridianView[];

function compactAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

export function MeridianAppShell() {
  const connection = useConnection();
  const disconnectMutation = useDisconnect();

  const [session, setSession] = useState<AuthSession | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [activeView, setActiveView] = useState<MeridianView>("overview");
  const [privacyShield, setPrivacyShield] = useState(true);
  const [railExpanded, setRailExpanded] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [notificationNoticeOpen, setNotificationNoticeOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    const timeout = window.setTimeout(() => {
      controller.abort();
    }, SESSION_BOOTSTRAP_TIMEOUT_MS);

    void fetch("/api/auth/session", {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response): Promise<unknown> => {
        if (!response.ok) return null;
        return response.json() as Promise<unknown>;
      })
      .catch(() => null)
      .then((body: unknown) => {
        if (cancelled) return;

        if (
          body !== null &&
          typeof body === "object" &&
          "authenticated" in body &&
          body.authenticated === true &&
          "address" in body &&
          typeof body.address === "string" &&
          "chainId" in body &&
          typeof body.chainId === "number" &&
          "expiresAt" in body &&
          typeof body.expiresAt === "string"
        ) {
          setSession({
            address: getAddress(body.address),
            chainId: body.chainId,
            expiresAt: body.expiresAt,
          });
        }
      })
      .finally(() => {
        window.clearTimeout(timeout);

        if (!cancelled) {
          setSessionChecked(true);
        }
      });

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, []);

  const navigate = useCallback((view: MeridianView) => {
    setActiveView(view);

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const typing = isTypingTarget(event.target);

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();

        setCommandOpen((current) => !current);
        return;
      }

      if (!typing && event.shiftKey && event.key.toLowerCase() === "p") {
        event.preventDefault();

        setPrivacyShield((current) => !current);
        return;
      }

      if (event.key === "Escape") {
        setCommandOpen(false);
        setNotificationNoticeOpen(false);
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/signout", {
      method: "POST",
      credentials: "same-origin",
    }).catch(() => null);

    disconnectMutation.mutate();

    setSession(null);
    setWalletOpen(false);
    setCommandOpen(false);
    setNotificationNoticeOpen(false);
    setActiveView("overview");
  }, [disconnectMutation]);

  const changeWallet = useCallback(async () => {
    await signOut();
  }, [signOut]);

  const activeNavigation = useMemo(() => meridianNavigationItem(activeView), [activeView]);

  if (!sessionChecked) {
    return (
      <main className={styles.sessionLoading}>
        <VeilpotMark />
        <span>Checking your secure session…</span>
      </main>
    );
  }

  if (session === null) {
    return (
      <SignInGate
        onSignedIn={(nextSession) => {
          setSession(nextSession);
        }}
      />
    );
  }

  const walletMismatch =
    connection.address !== undefined &&
    connection.address.toLowerCase() !== session.address.toLowerCase();

  const connectedWrongNetwork =
    connection.isConnected && connection.chainId !== VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId;

  const sessionWrongNetwork = session.chainId !== VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.chainId;

  const blockedContext = walletMismatch || connectedWrongNetwork || sessionWrongNetwork;

  return (
    <main
      className={`${styles.appRoot} ${railExpanded ? styles.appRootExpanded : ""}`}
      data-privacy-shield={privacyShield ? "on" : "off"}
    >
      <a className={styles.skipLink} href="#meridian-workspace">
        Skip to workspace
      </a>

      <aside className={styles.commandRail} aria-label="Primary navigation">
        <div className={styles.railBrand}>
          <VeilpotMark compact={!railExpanded} />
        </div>

        <nav className={styles.railNavigation}>
          {MERIDIAN_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeView === item.view;

            return (
              <button
                key={item.view}
                type="button"
                className={active ? styles.railButtonActive : styles.railButton}
                aria-current={active ? "page" : undefined}
                aria-label={item.label}
                title={railExpanded ? undefined : item.label}
                onClick={() => {
                  navigate(item.view);
                }}
              >
                <Icon size={18} aria-hidden="true" />

                <span className={styles.railLabel} aria-hidden={!railExpanded}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </nav>

        <button
          className={styles.railExpandButton}
          type="button"
          aria-label={railExpanded ? "Collapse command rail" : "Expand command rail"}
          aria-expanded={railExpanded}
          onClick={() => {
            setRailExpanded((current) => !current);
          }}
        >
          {railExpanded ? (
            <ChevronLeft size={17} aria-hidden="true" />
          ) : (
            <ChevronRight size={17} aria-hidden="true" />
          )}

          <span className={styles.railLabel}>{railExpanded ? "Collapse" : "Expand"}</span>
        </button>
      </aside>

      <header className={styles.contextBar}>
        <div className={styles.mobileBrand}>
          <VeilpotMark compact />
        </div>

        <div className={styles.contextTitle}>
          <span>{activeNavigation.label}</span>
          <small>{activeNavigation.description}</small>
        </div>

        <div className={styles.contextActions}>
          <button
            className={styles.commandTrigger}
            type="button"
            aria-label="Open command menu"
            onClick={() => {
              setCommandOpen(true);
            }}
          >
            <Search size={15} aria-hidden="true" />
            <span>Search</span>
            <kbd>⌘K</kbd>
          </button>

          <ThemeControl compact />

          <ProtocolBadge>Sepolia</ProtocolBadge>

          <button
            className={privacyShield ? styles.iconButtonActive : styles.iconButton}
            type="button"
            aria-label="Toggle Privacy Shield"
            aria-pressed={privacyShield}
            title="Privacy Shield · Shift+P"
            onClick={() => {
              setPrivacyShield((current) => !current);
            }}
          >
            <LockKeyhole size={16} aria-hidden="true" />
          </button>

          <button
            className={styles.iconButton}
            type="button"
            aria-label="Notifications"
            onClick={() => {
              setNotificationNoticeOpen(true);
            }}
          >
            <Bell size={16} aria-hidden="true" />
          </button>

          <button
            className={styles.accountButton}
            type="button"
            onClick={() => {
              setWalletOpen(true);
            }}
          >
            <span className={styles.accountAvatar}>
              <UserRound size={15} aria-hidden="true" />
            </span>

            <span className={styles.accountCopy}>
              <strong>Account</strong>
              <small>{compactAddress(session.address)}</small>
            </span>
          </button>
        </div>
      </header>

      <div className={styles.appBody}>
        {blockedContext ? (
          <div className={styles.contextWarning} role="alert">
            <ShieldAlert size={18} aria-hidden="true" />

            <div>
              <strong>Wallet context needs attention</strong>

              <span>
                {walletMismatch
                  ? `Your authenticated session belongs to ${compactAddress(
                      session.address,
                    )}. Reconnect that wallet before any financial action.`
                  : connectedWrongNetwork
                    ? "Your connected wallet is not on Ethereum Sepolia. Financial actions remain blocked."
                    : "The authenticated session is not bound to the active Sepolia application profile."}
              </span>
            </div>

            <button
              type="button"
              onClick={() => {
                setWalletOpen(true);
              }}
            >
              Wallet controls
            </button>
          </div>
        ) : null}

        <MeridianWorkspace
          authenticatedAddress={session.address}
          view={activeView}
          privacyShield={privacyShield}
          onNavigate={navigate}
          onOpenWallet={() => {
            setWalletOpen(true);
          }}
          onTogglePrivacy={() => {
            setPrivacyShield((current) => !current);
          }}
        />
      </div>

      <nav className={styles.mobileNavigation} aria-label="Mobile navigation">
        {MOBILE_PRIMARY_VIEWS.map((view) => {
          const item = meridianNavigationItem(view);
          const Icon = item.icon;
          const active = activeView === view;

          return (
            <button
              type="button"
              key={view}
              className={active ? styles.mobileNavActive : styles.mobileNavButton}
              aria-current={active ? "page" : undefined}
              onClick={() => {
                navigate(view);
              }}
            >
              <Icon size={18} aria-hidden="true" />
              <span>{item.shortLabel}</span>
            </button>
          );
        })}

        <button
          className={styles.mobileNavButton}
          type="button"
          onClick={() => {
            setCommandOpen(true);
          }}
        >
          <Menu size={18} aria-hidden="true" />
          <span>More</span>
        </button>
      </nav>

      <MeridianCommandMenu
        open={commandOpen}
        onClose={() => {
          setCommandOpen(false);
        }}
        onNavigate={navigate}
        onOpenWallet={() => {
          setWalletOpen(true);
        }}
      />

      <WalletCenter
        open={walletOpen}
        sessionAddress={session.address}
        onClose={() => {
          setWalletOpen(false);
        }}
        onSignOut={signOut}
        onChangeWallet={changeWallet}
      />

      {notificationNoticeOpen ? (
        <div
          className={styles.noticeRoot}
          role="dialog"
          aria-modal="true"
          aria-labelledby="notification-migration-title"
        >
          <button
            className={styles.noticeScrim}
            type="button"
            aria-label="Close notifications"
            onClick={() => {
              setNotificationNoticeOpen(false);
            }}
          />

          <aside className={styles.noticePanel}>
            <header>
              <div>
                <span>PRIVATE NOTIFICATIONS</span>
                <h2 id="notification-migration-title">V2 notification feed</h2>
              </div>

              <button
                type="button"
                aria-label="Close notifications"
                onClick={() => {
                  setNotificationNoticeOpen(false);
                }}
              >
                <X size={17} aria-hidden="true" />
              </button>
            </header>

            <div className={styles.noticeContent}>
              <Bell size={21} aria-hidden="true" />

              <p>
                Meridian intentionally does not mount the historical V1 notification feed. The V2
                activity and notification index will be connected only after its exact V2 event
                surface is verified.
              </p>

              <small>
                No balance, contribution amount or private draw outcome is inferred while the feed
                is unavailable.
              </small>
            </div>

            <button
              className={styles.noticeAction}
              type="button"
              onClick={() => {
                setNotificationNoticeOpen(false);
                navigate("activity");
              }}
            >
              Open Activity
              <ChevronRight size={15} aria-hidden="true" />
            </button>
          </aside>
        </div>
      ) : null}

      <div className={styles.keyboardHint} aria-hidden="true">
        <Command size={12} />
        <span>⌘K</span>
        <i />
        <LockKeyhole size={12} />
        <span>⇧P</span>
      </div>
    </main>
  );
}
