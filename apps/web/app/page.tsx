import {
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Eye,
  KeyRound,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

import { VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT } from "@veilpot/protocol-sdk";

import styles from "@/app/meridian-home.module.css";
import { VeilpotMark } from "@/components/brand";
import {
  AddressText,
  CipherRibbon,
  ExplorerLink,
  HumanActionBadge,
  MeridianButton,
  MeridianPrivateValue,
  ProtocolBadge,
} from "@/components/meridian";
import { PrivateLedgerComposition } from "@/components/meridian/private-ledger-composition";
import { MeridianPublicNav } from "@/components/meridian/public-nav";
import { PublicProtocolBand } from "@/components/meridian/public-protocol-band";

const AUTOPILOT_WINDOWS = ["FRI 08:00", "FRI 08:00", "FRI 08:00", "FRI 08:00"] as const;

const PARTICIPATION_CELLS = Array.from({ length: 48 }, (_, index) => index);

const PRIVACY_ROWS = [
  {
    label: "Wallet address",
    side: "public",
  },
  {
    label: "Transaction existence",
    side: "public",
  },
  {
    label: "Participant lifecycle",
    side: "public",
  },
  {
    label: "Deposit amount",
    side: "private",
  },
  {
    label: "Principal",
    side: "private",
  },
  {
    label: "Autopilot amounts",
    side: "private",
  },
  {
    label: "Draw weight",
    side: "private",
  },
  {
    label: "Winner predicate",
    side: "private",
  },
  {
    label: "Prize entitlement",
    side: "private",
    note: "Private until beneficiary reveal",
  },
] as const;

const RECOVERY_STORIES = [
  {
    title: "Reservation expired",
    problem: "The participant reservation reached its deadline before a deposit started.",
    action: "Release the expired reservation and reclaim any credited registration bond.",
  },
  {
    title: "Activation proof delayed",
    problem: "A pending activation was not settled before its proof deadline.",
    action: "Use the protocol refund path rather than submitting the same deposit blindly.",
  },
  {
    title: "Autopilot window missed",
    problem: "A bounded schedule window elapsed without execution.",
    action: "Advance the missed window safely; later committed windows remain bounded.",
  },
  {
    title: "Claim settlement pending",
    problem: "A prize transfer is waiting for authenticated completion evidence.",
    action: "Reconcile or refresh completion evidence without duplicating the claim.",
  },
] as const;

const DEPLOYMENT_ROWS = [
  {
    label: "Pool V2",
    address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.pool,
  },
  {
    label: "VeilDraw Engine V2",
    address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.engine,
  },
  {
    label: "Autopilot Vault",
    address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.vault,
  },
  {
    label: "Yield Adapter V2",
    address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.adapter,
  },
  {
    label: "Prize Reserve",
    address: VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.reserve,
  },
] as const;

function shortAddress(address: string): string {
  return `${address.slice(0, 8)}…${address.slice(-6)}`;
}

export default function HomePage() {
  return (
    <main className={styles.home}>
      <MeridianPublicNav />

      <section className={styles.hero} id="top">
        <div className={styles.heroCopy}>
          <span className={styles.eyebrow}>PRIVATE PRIZE SAVINGS</span>

          <h1>
            Save quietly.
            <br />
            Let your money participate.
          </h1>

          <p className={styles.heroBody}>
            Confidential principal, bounded automation and private prize outcomes — presented like
            serious financial software instead of a casino or crypto terminal.
          </p>

          <div className={styles.heroActions}>
            <Link className="vp-button" data-variant="primary" data-size="large" href="/app">
              Open Veilpot
              <ArrowRight size={16} aria-hidden="true" />
            </Link>

            <a className={styles.secondaryCta} href="#privacy">
              See how privacy works
              <ChevronRight size={15} aria-hidden="true" />
            </a>
          </div>

          <div className={styles.heroTrust} aria-label="Protocol trust indicators">
            <span>Zama Confidential Tokens</span>
            <span>Ethereum Sepolia</span>
            <span>No automatic decryption</span>
            <span>Testnet</span>
          </div>
        </div>

        <PrivateLedgerComposition />
      </section>

      <PublicProtocolBand />

      <section className={styles.story} id="product">
        <header className={styles.sectionHeader}>
          <span className={styles.eyebrow}>PRIVATE CAPITAL IN MOTION</span>
          <h2>
            One private position.
            <br />
            Four understandable stages.
          </h2>
          <p>
            The interface follows what actually happens: save, automate, participate and claim. The
            cryptography stays rigorous without forcing ordinary users to operate the protocol by
            hand.
          </p>
        </header>

        <article className={styles.chapter}>
          <div className={styles.chapterCopy}>
            <span>CHAPTER 01 · SAVE</span>
            <h3>Your amount becomes encrypted before protocol submission.</h3>
            <p>
              Deposit values are confidential inputs, not public profile metadata. The transaction
              can exist publicly without publishing the amount.
            </p>

            <ProtocolBadge>Encryption before submission</ProtocolBadge>
          </div>

          <div className={`${styles.chapterVisual} ${styles.saveVisual}`}>
            <div className={styles.exampleAmount}>
              <span>ILLUSTRATIVE AMOUNT</span>
              <strong>250 cUSDT</strong>
              <small>Example only · not live account data</small>
            </div>

            <ArrowRight size={20} aria-hidden="true" />

            <div className={styles.encryptionField}>
              <CipherRibbon />
              <span>Encrypted contribution</span>
            </div>
          </div>
        </article>

        <article className={`${styles.chapter} ${styles.chapterReverse}`} id="autopilot">
          <div className={styles.chapterCopy}>
            <span>CHAPTER 02 · AUTOMATE</span>
            <h3>Automation with limits, not unlimited authority.</h3>
            <p>
              Autopilot commits exact finite windows and a lifetime authorization boundary. Keepers
              can execute valid windows; they do not gain custody or arbitrary withdrawal authority.
            </p>

            <HumanActionBadge>Human-defined authorization</HumanActionBadge>
          </div>

          <div className={`${styles.chapterVisual} ${styles.autopilotVisual}`}>
            <header>
              <CalendarClock size={17} aria-hidden="true" />
              <span>ILLUSTRATIVE BOUNDED SCHEDULE</span>
            </header>

            <div className={styles.scheduleTimeline}>
              {AUTOPILOT_WINDOWS.map((window, index) => (
                <div key={`${window}-${String(index)}`}>
                  <i aria-hidden="true" />
                  <span>{window}</span>
                </div>
              ))}
            </div>

            <div className={styles.lifetimeBracket}>
              <i aria-hidden="true" />
              <span>Lifetime authorization ends here</span>
              <i aria-hidden="true" />
            </div>

            <small>Illustrative schedule · not a wallet plan</small>
          </div>
        </article>

        <article className={styles.chapter} id="veildraw">
          <div className={styles.chapterCopy}>
            <span>CHAPTER 03 · PARTICIPATE</span>
            <h3>Private weight enters a public lifecycle.</h3>
            <p>
              VeilDraw can expose snapshot and finality progress without exposing draw weight,
              selected shard, winner predicate or private entitlement.
            </p>

            <ProtocolBadge>Public lifecycle · private selection</ProtocolBadge>
          </div>

          <div className={`${styles.chapterVisual} ${styles.drawVisual}`}>
            <div className={styles.drawLabels}>
              <span>TWAB PRIVATE</span>
              <span>SNAPSHOT PUBLIC LIFECYCLE</span>
              <span>SELECTION PRIVATE</span>
              <span>FINALITY PUBLIC</span>
            </div>

            <div
              className={styles.participationGrid}
              aria-label="Conceptual encrypted participant field"
            >
              {PARTICIPATION_CELLS.map((cell) => (
                <i key={cell} aria-hidden="true" />
              ))}
            </div>

            <CipherRibbon quiet />
          </div>
        </article>

        <article className={`${styles.chapter} ${styles.chapterReverse}`}>
          <div className={styles.chapterCopy}>
            <span>CHAPTER 04 · CLAIM</span>
            <h3>Revealing is a separate action.</h3>
            <p>
              A private entitlement can remain sealed until the frozen historical beneficiary
              explicitly authorizes private decryption. Claiming does not require automatic reveal.
            </p>

            <HumanActionBadge>Beneficiary-controlled reveal</HumanActionBadge>
          </div>

          <div className={`${styles.chapterVisual} ${styles.claimVisual}`}>
            <div className={styles.claimState}>
              <span>SEALED ENTITLEMENT</span>

              <MeridianPrivateValue
                label="Prize amount"
                state="sealed"
                detail="Private until authorized"
              />

              <MeridianButton variant="private" disabled>
                <KeyRound size={15} aria-hidden="true" />
                Authorize reveal
              </MeridianButton>
            </div>

            <ChevronRight className={styles.claimArrow} size={20} aria-hidden="true" />

            <div className={styles.illustrativeReveal}>
              <span>ILLUSTRATIVE REVEAL EXAMPLE</span>
              <Eye size={17} aria-hidden="true" />
              <strong>12.50 cUSDT</strong>
              <small>
                Not live. Real values appear only after successful beneficiary-authorized
                decryption.
              </small>
            </div>
          </div>
        </article>
      </section>

      <section className={styles.privacySection} id="privacy">
        <div className={styles.privacyIntro}>
          <span className={styles.eyebrow}>PRIVACY, MADE LEGIBLE</span>

          <h2>
            Public where verification needs it.
            <br />
            Private where your finances need it.
          </h2>

          <p>
            Privacy should be visible as a product property, not hidden inside technical
            documentation.
          </p>
        </div>

        <div className={styles.privacyLedger}>
          <header>
            <span>PUBLIC</span>
            <span>PRIVATE</span>
          </header>

          <div className={styles.privacyDivider} aria-hidden="true" />

          {PRIVACY_ROWS.map((row) => (
            <div className={styles.privacyRow} data-side={row.side} key={row.label}>
              <div>
                {row.side === "public" ? (
                  <>
                    <CircleDot size={13} aria-hidden="true" />
                    <strong>{row.label}</strong>
                  </>
                ) : null}
              </div>

              <span>{"note" in row ? row.note : ""}</span>

              <div>
                {row.side === "private" ? (
                  <>
                    <LockKeyhole size={13} aria-hidden="true" />
                    <strong>{row.label}</strong>
                  </>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.recoverySection}>
        <header className={styles.sectionHeader}>
          <span className={styles.eyebrow}>RECOVERY IS PART OF THE PRODUCT</span>

          <h2>Privacy should not mean getting stuck.</h2>

          <p>
            Recoverable protocol states become clear next actions instead of unexplained terminal
            errors.
          </p>
        </header>

        <div className={styles.recoveryGrid}>
          {RECOVERY_STORIES.map((story) => (
            <article key={story.title}>
              <header>
                <RefreshCw size={17} aria-hidden="true" />
                <h3>{story.title}</h3>
              </header>

              <p>{story.problem}</p>

              <div>
                <CheckCircle2 size={15} aria-hidden="true" />
                <span>{story.action}</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.securitySection} id="security">
        <div className={styles.securityIntro}>
          <span className={styles.eyebrow}>SECURITY & PROTOCOL IDENTITY</span>

          <h2>
            Inspect the system.
            <br />
            Do not rely on a marketing claim.
          </h2>

          <p>
            Meridian targets the explicit V2 Sepolia deployment. The current asset is an official
            Zama testnet mock confidential asset, and yield is the V2 simulated three-prize testnet
            profile.
          </p>

          <div className={styles.securityBadges}>
            <ProtocolBadge>V2 Sepolia profile</ProtocolBadge>

            <HumanActionBadge>No automatic private reveal</HumanActionBadge>
          </div>
        </div>

        <div className={styles.deploymentPanel}>
          <header>
            <ShieldCheck size={18} aria-hidden="true" />
            <div>
              <strong>Veilpot V2 deployment</strong>
              <span>Ethereum Sepolia · chain 11155111</span>
            </div>
          </header>

          <div className={styles.deploymentRows}>
            {DEPLOYMENT_ROWS.map((row) => (
              <div key={row.label}>
                <span>{row.label}</span>

                <AddressText>{shortAddress(row.address)}</AddressText>

                <ExplorerLink href={`https://sepolia.etherscan.io/address/${row.address}`}>
                  Inspect
                </ExplorerLink>
              </div>
            ))}
          </div>

          <footer>
            <span>Source checkpoint</span>
            <code>{VEILPOT_ACTIVE_SEPOLIA_DEPLOYMENT.deploymentSourceCommit}</code>
          </footer>
        </div>
      </section>

      <section className={styles.closingSection}>
        <CipherRibbon quiet />

        <div>
          <span className={styles.eyebrow}>VEILPOT MERIDIAN</span>
          <h2>
            Private savings should feel calm.
            <br />
            The cryptography can stay complex underneath.
          </h2>
        </div>

        <Link className="vp-button" data-variant="primary" data-size="large" href="/app">
          Open Veilpot
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      </section>

      <footer className={styles.footer}>
        <VeilpotMark compact />

        <span>Confidential prize savings on Ethereum Sepolia</span>

        <nav aria-label="Footer navigation">
          <a href="#privacy">Privacy</a>
          <a href="#security">Security</a>
          <a href="#product">Product</a>
          <Link href="/app">Open app</Link>
        </nav>
      </footer>
    </main>
  );
}
