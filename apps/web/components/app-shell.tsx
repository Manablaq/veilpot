"use client";

import {
  Activity,
  Bell,
  BookOpen,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  FileText,
  Gift,
  Home,
  LifeBuoy,
  LockKeyhole,
  Menu,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  UserRound,
  Vault,
  WalletCards,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getAddress } from "viem";
import { useConnection, useDisconnect } from "wagmi";

import { ActionSheet, type PreviewAction } from "@/components/action-sheet";
import { NetworkPill, VeilpotMark } from "@/components/brand";
import { CommandMenu } from "@/components/command-menu";
import { LiveAccountOverview } from "@/components/live-account-overview";
import { MobileDrawer } from "@/components/mobile-drawer";
import { NotificationCenter } from "@/components/notification-center";
import { PrivacyValue } from "@/components/privacy-value";
import { ProfileCenter } from "@/components/profile-center";
import { SignInGate, type AuthSession } from "@/components/sign-in-gate";
import { ThemeControl } from "@/components/theme-control";
import { WalletCenter } from "@/components/wallet-center";
import { type WorkspaceView, WorkspacePanel } from "@/components/workspace-panel";
import { PRODUCT } from "@/lib/product";

const navigation = [
  { label: "Home", view: "home" as const, icon: Home },
  { label: "Pots", view: "pots" as const, icon: Vault },
  { label: "Autopilot", view: "autopilot" as const, icon: CalendarClock },
  { label: "Draws", view: "draws" as const, icon: Gift },
  { label: "Portfolio", view: "portfolio" as const, icon: Activity },
] as const;

function compactAddress(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function AppShell() {
  const connection = useConnection();
  const disconnectMutation = useDisconnect();
  const [session, setSession] = useState<AuthSession | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [privacyShield, setPrivacyShield] = useState(true);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationUnreadCount, setNotificationUnreadCount] = useState(0);
  const [profileOpen, setProfileOpen] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const [action, setAction] = useState<PreviewAction>(null);
  const [activeView, setActiveView] = useState<WorkspaceView>("home");
  const [commandOpen, setCommandOpen] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" })
      .then(async (response): Promise<unknown> => {
        if (!response.ok) return null;
        const body: unknown = await response.json();
        return body;
      })
      .then((body: unknown) => {
        if (cancelled) return;
        if (
          body &&
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
        if (!cancelled) setSessionChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen((current) => !current);
      }
      if (event.key === "Escape") {
        setCommandOpen(false);
        setMobileDrawerOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const signOut = useCallback(async () => {
    await fetch("/api/auth/signout", { method: "POST", credentials: "same-origin" }).catch(
      () => null,
    );
    disconnectMutation.mutate();
    setSession(null);
    setWalletOpen(false);
    setProfileOpen(false);
    setNotificationsOpen(false);
    setActiveView("home");
  }, [disconnectMutation]);

  const changeWallet = useCallback(async () => {
    await signOut();
  }, [signOut]);

  const navigate = useCallback((view: WorkspaceView) => {
    setActiveView(view);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  useEffect(() => {
    const onNavigate = (event: Event) => {
      const next = (event as CustomEvent<string>).detail;
      if (
        next === "home" ||
        next === "pots" ||
        next === "autopilot" ||
        next === "draws" ||
        next === "portfolio" ||
        next === "activity" ||
        next === "statements" ||
        next === "privacy" ||
        next === "trust" ||
        next === "help" ||
        next === "settings"
      ) {
        navigate(next);
      }
    };
    window.addEventListener("veilpot:navigate", onNavigate);
    return () => {
      window.removeEventListener("veilpot:navigate", onNavigate);
    };
  }, [navigate]);

  const connectionMismatch = useMemo(() => {
    if (!session || !connection.address) return false;
    return connection.address.toLowerCase() !== session.address.toLowerCase();
  }, [connection.address, session]);

  if (!sessionChecked) {
    return (
      <main className="session-loading">
        <VeilpotMark />
        <span>Checking your secure session…</span>
      </main>
    );
  }

  if (!session) {
    return (
      <SignInGate
        onSignedIn={(nextSession) => {
          setSession(nextSession);
        }}
      />
    );
  }

  const openAction = (next: Exclude<PreviewAction, null>) => {
    if (next === "plan") {
      navigate("autopilot");
      return;
    }
    setAction(next);
  };

  return (
    <main className={privacyShield ? "human-app privacy-shield-on" : "human-app"}>
      <div className="testnet-banner">
        <strong>Sepolia testnet</strong>
        <span>
          Veilpot currently uses Zama test assets and simulated yield. Do not treat this environment
          as mainnet savings.
        </span>
        <button
          type="button"
          onClick={() => {
            navigate("trust");
          }}
        >
          Environment details
        </button>
      </div>

      {connectionMismatch ? (
        <div className="account-warning">
          <strong>Wallet mismatch</strong>
          <span>
            Your authenticated session belongs to {compactAddress(session.address)}. Reconnect that
            wallet before any financial action.
          </span>
          <button
            type="button"
            onClick={() => {
              setWalletOpen(true);
            }}
          >
            Open wallet controls
          </button>
        </div>
      ) : null}

      <header className="human-header">
        <div className="human-header-left">
          <button
            className="mobile-menu-button"
            type="button"
            aria-label="Open navigation"
            onClick={() => {
              setMobileDrawerOpen(true);
            }}
          >
            <Menu size={18} />
          </button>
          <VeilpotMark />
        </div>
        <nav className="human-primary-nav" aria-label="Primary">
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={activeView === item.view ? "active" : ""}
                type="button"
                key={item.view}
                onClick={() => {
                  navigate(item.view);
                }}
              >
                <Icon size={15} /> {item.label}
              </button>
            );
          })}
        </nav>
        <div className="human-header-actions">
          <button
            className="header-search"
            type="button"
            onClick={() => {
              setCommandOpen(true);
            }}
          >
            <Search size={15} />
            <span>Search</span>
            <kbd>⌘K</kbd>
          </button>
          <ThemeControl compact />
          <NetworkPill />
          <button
            className={privacyShield ? "header-icon active" : "header-icon"}
            type="button"
            aria-label="Toggle Privacy Shield"
            aria-pressed={privacyShield}
            onClick={() => {
              setPrivacyShield((current) => !current);
            }}
          >
            <LockKeyhole size={16} />
          </button>
          <button
            className={notificationUnreadCount > 0 ? "header-icon has-indicator" : "header-icon"}
            type="button"
            aria-label={
              notificationUnreadCount > 0
                ? `Notifications · ${notificationUnreadCount.toString()} unread`
                : "Notifications"
            }
            onClick={() => {
              setNotificationsOpen(true);
            }}
          >
            <Bell size={16} />
            {notificationUnreadCount > 0 ? <i /> : null}
          </button>
          <button
            className="account-button"
            type="button"
            onClick={() => {
              setProfileOpen(true);
            }}
          >
            <span className="account-avatar">
              <UserRound size={15} />
            </span>
            <span className="account-button-copy">
              <strong>Account</strong>
              <small>{compactAddress(session.address)}</small>
            </span>
            <ChevronDown size={14} />
          </button>
        </div>
      </header>

      <div className="human-app-layout">
        <aside className="human-utility-rail">
          <div className="utility-section">
            <span>ACCOUNT</span>
            <button
              type="button"
              className={activeView === "home" ? "active" : ""}
              onClick={() => {
                navigate("home");
              }}
            >
              <Home size={16} /> Overview
            </button>
            <button
              type="button"
              className={activeView === "activity" ? "active" : ""}
              onClick={() => {
                navigate("activity");
              }}
            >
              <Activity size={16} /> Activity
            </button>
            <button
              type="button"
              className={activeView === "statements" ? "active" : ""}
              onClick={() => {
                navigate("statements");
              }}
            >
              <FileText size={16} /> Statements
            </button>
          </div>
          <div className="utility-section">
            <span>CONTROL</span>
            <button
              type="button"
              onClick={() => {
                setWalletOpen(true);
              }}
            >
              <WalletCards size={16} /> Wallet & access
            </button>
            <button
              type="button"
              className={activeView === "privacy" ? "active" : ""}
              onClick={() => {
                navigate("privacy");
              }}
            >
              <LockKeyhole size={16} /> Privacy
            </button>
            <button
              type="button"
              className={activeView === "trust" ? "active" : ""}
              onClick={() => {
                navigate("trust");
              }}
            >
              <ShieldCheck size={16} /> Trust & security
            </button>
          </div>
          <div className="utility-section grow">
            <span>SUPPORT</span>
            <button
              type="button"
              className={activeView === "help" ? "active" : ""}
              onClick={() => {
                navigate("help");
              }}
            >
              <BookOpen size={16} /> How Veilpot works
            </button>
            <button
              type="button"
              onClick={() => {
                navigate("help");
              }}
            >
              <LifeBuoy size={16} /> Help center
            </button>
            <button
              type="button"
              className={activeView === "settings" ? "active" : ""}
              onClick={() => {
                navigate("settings");
              }}
            >
              <Settings size={16} /> Settings
            </button>
          </div>
          <div className="utility-status-card">
            <CircleCheck size={16} />
            <div>
              <strong>Live state stays authoritative</strong>
              <span>Account actions read Sepolia state before they prepare a transaction.</span>
            </div>
          </div>
        </aside>

        <section className="human-main-content">
          {activeView !== "home" ? (
            <WorkspacePanel
              authenticatedAddress={session.address}
              view={activeView}
              onNavigate={navigate}
              onNewPot={() => {
                openAction("plan");
              }}
              onOpenWallet={() => {
                setWalletOpen(true);
              }}
              onOpenNotifications={() => {
                setNotificationsOpen(true);
              }}
              onTogglePrivacy={() => {
                setPrivacyShield((current) => !current);
              }}
              privacyShield={privacyShield}
            />
          ) : (
            <>
              <div className="welcome-row">
                <div>
                  <span className="eyebrow">YOUR PRIVATE ACCOUNT</span>
                  <h1>Your private account is ready.</h1>
                  <p>
                    Live protocol state stays authoritative. Private values remain hidden unless you
                    explicitly reveal them.
                  </p>
                </div>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => {
                    openAction("plan");
                  }}
                >
                  <Plus size={16} /> New saving pot
                </button>
              </div>
              <LiveAccountOverview authenticatedAddress={session.address} compact />
              <section className="today-card">
                <div className="today-card-status">
                  <CircleCheck size={19} />
                </div>
                <div className="today-card-copy">
                  <span>TODAY</span>
                  <strong>Live status is never inferred.</strong>
                  <p>
                    Open an account action to read current Sepolia state. Veilpot does not infer a
                    schedule, balance, funded-window count, or next contribution.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    navigate("autopilot");
                  }}
                >
                  Review Autopilot <ChevronRight size={15} />
                </button>
              </section>
              <div className="overview-grid">
                <section className="account-summary-card private-surface">
                  <header>
                    <div>
                      <span>PRIVATE SAVINGS</span>
                      <small>Never auto-decrypted</small>
                    </div>
                    <span className="status-pill">
                      <i /> Private
                    </span>
                  </header>
                  <PrivacyValue value="Not decrypted" label="confidential savings value" large />
                  <div className="summary-facts">
                    <div>
                      <span>Active pots</span>
                      <strong>—</strong>
                    </div>
                    <div>
                      <span>Funded windows</span>
                      <strong>—</strong>
                    </div>
                    <div>
                      <span>Next contribution</span>
                      <strong>Not loaded</strong>
                    </div>
                  </div>
                  <footer>
                    <button
                      type="button"
                      onClick={() => {
                        openAction("deposit");
                      }}
                    >
                      Deposit
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        openAction("withdraw");
                      }}
                    >
                      Withdraw
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPrivacyShield((current) => !current);
                      }}
                    >
                      <LockKeyhole size={14} />{" "}
                      {privacyShield ? "Privacy Shield on" : "Hide private values"}
                    </button>
                  </footer>
                </section>
                <section className="runway-card">
                  <header>
                    <span>AUTOPILOT RUNWAY</span>
                    <small>Live plan status</small>
                  </header>
                  <div className="runway-number">
                    <strong>—</strong>
                    <span>not inferred from presentation data</span>
                  </div>
                  <div className="runway-meter">
                    <i style={{ width: "0%" }} />
                  </div>
                  <div className="runway-facts">
                    <div>
                      <span>Next window</span>
                      <strong>Not loaded</strong>
                    </div>
                    <div>
                      <span>Plan state</span>
                      <strong>Not loaded</strong>
                    </div>
                    <div>
                      <span>Keeper authority</span>
                      <strong>Execution only</strong>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      navigate("autopilot");
                    }}
                  >
                    Manage Autopilot <ChevronRight size={15} />
                  </button>
                </section>
              </div>
              <section className="human-section">
                <header className="human-section-header">
                  <div>
                    <span className="eyebrow">LIVE SAVING POTS</span>
                    <h2>Canonical Autopilot plans live in one place.</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      navigate("autopilot");
                    }}
                  >
                    Open Autopilot <ChevronRight size={15} />
                  </button>
                </header>
                <p>
                  Veilpot no longer substitutes illustrative progress, runway, contribution dates,
                  or balances for account state. Discover plans from the Sepolia Vault.
                </p>
              </section>
              <div className="lower-grid">
                <section className="human-section draw-summary">
                  <header className="human-section-header compact">
                    <div>
                      <span className="eyebrow">LIVE VEILDRAW</span>
                      <h2>Inspect the current encrypted draw lifecycle.</h2>
                    </div>
                    <Gift size={18} />
                  </header>
                  <p>
                    Snapshot, proof, batch, winner-resolution, and PrizeReserve controls read
                    canonical Sepolia state. Winner data is never inferred or automatically
                    revealed.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      navigate("draws");
                    }}
                  >
                    Open live draw controls <ChevronRight size={15} />
                  </button>
                </section>
                <section className="human-section activity-summary">
                  <header className="human-section-header compact">
                    <div>
                      <span className="eyebrow">LIVE ACTIVITY</span>
                      <h2>Read recent public protocol events.</h2>
                    </div>
                    <Activity size={18} />
                  </header>
                  <p>
                    Account activity is loaded from Sepolia events. Confidential transferred values
                    are never reconstructed from presentation fixtures.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      navigate("activity");
                    }}
                  >
                    Open live activity <ChevronRight size={15} />
                  </button>
                </section>
              </div>
              <section className="trust-strip">
                <div>
                  <ShieldCheck size={20} />
                  <span>
                    <strong>Built to be inspectable.</strong> Review network, contracts, privacy
                    boundaries, and testnet disclosures in one place.
                  </span>
                </div>
                <div className="trust-strip-facts">
                  <span>
                    Pool <code>{PRODUCT.deployment.pool.slice(0, 8)}…</code>
                  </span>
                  <span>
                    Vault <code>{PRODUCT.deployment.vault.slice(0, 8)}…</code>
                  </span>
                  <span>Sepolia · 11155111</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    navigate("trust");
                  }}
                >
                  Trust center <ChevronRight size={15} />
                </button>
              </section>
            </>
          )}
        </section>
      </div>

      <footer className="human-footer">
        <span>Veilpot · private savings on Sepolia</span>
        <nav>
          <button
            type="button"
            onClick={() => {
              navigate("privacy");
            }}
          >
            Privacy
          </button>
          <Link href="/#terms">Terms</Link>
          <button
            type="button"
            onClick={() => {
              navigate("trust");
            }}
          >
            Security
          </button>
          <button
            type="button"
            onClick={() => {
              navigate("help");
            }}
          >
            Support
          </button>
        </nav>
      </footer>
      <nav className="human-mobile-nav" aria-label="Mobile navigation">
        {(
          [
            ["home", "Home", Home],
            ["pots", "Pots", Vault],
            ["draws", "Draws", Gift],
          ] as const
        ).map(([view, label, Icon]) => (
          <button
            className={activeView === view ? "active" : ""}
            type="button"
            key={view}
            onClick={() => {
              navigate(view);
            }}
          >
            <Icon size={18} /> {label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            setNotificationsOpen(true);
          }}
        >
          <Bell size={18} />{" "}
          {notificationUnreadCount > 0
            ? `Alerts (${Math.min(notificationUnreadCount, 99).toString()})`
            : "Alerts"}
        </button>
        <button
          type="button"
          onClick={() => {
            setProfileOpen(true);
          }}
        >
          <UserRound size={18} /> You
        </button>
      </nav>

      <ActionSheet
        action={action}
        authenticatedAddress={session.address}
        onClose={() => {
          setAction(null);
        }}
      />
      <NotificationCenter
        open={notificationsOpen}
        authenticatedAddress={session.address}
        onUnreadCountChange={setNotificationUnreadCount}
        onClose={() => {
          setNotificationsOpen(false);
        }}
        onNavigate={navigate}
      />
      <ProfileCenter
        open={profileOpen}
        address={session.address}
        onClose={() => {
          setProfileOpen(false);
        }}
        onOpenWallet={() => {
          setWalletOpen(true);
        }}
        onNavigate={navigate}
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
      <CommandMenu
        open={commandOpen}
        onClose={() => {
          setCommandOpen(false);
        }}
        onNavigate={navigate}
        onOpenWallet={() => {
          setWalletOpen(true);
        }}
      />
      <MobileDrawer
        open={mobileDrawerOpen}
        active={activeView}
        onClose={() => {
          setMobileDrawerOpen(false);
        }}
        onNavigate={navigate}
        onOpenWallet={() => {
          setWalletOpen(true);
        }}
      />
    </main>
  );
}
