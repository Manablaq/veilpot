import {
  ArrowRight,
  CalendarClock,
  ChevronRight,
  CircleCheck,
  Gift,
  LockKeyhole,
  ShieldCheck,
  WalletCards,
} from "lucide-react";
import Link from "next/link";

import { VeilpotMark } from "@/components/brand";
import { ThemeControl } from "@/components/theme-control";

const principles = [
  {
    title: "Private by default",
    body: "Balances, contribution amounts, and draw outcomes are not turned into public profile data.",
  },
  {
    title: "Exact automation",
    body: "Autopilot follows the schedule and lifetime authorization you approve — not an unlimited standing mandate.",
  },
  {
    title: "Human recovery",
    body: "Partial transfers, missed windows, proof delays, revocation, and residual recovery get explicit next steps.",
  },
] as const;

export default function HomePage() {
  return (
    <main className="public-human-page">
      <header className="public-human-header">
        <VeilpotMark />
        <nav aria-label="Public navigation">
          <a href="#how">How it works</a>
          <a href="#privacy">Privacy</a>
          <a href="#trust">Trust</a>
          <a href="#help">Help</a>
        </nav>
        <div className="public-header-actions">
          <ThemeControl compact />
          <Link className="public-signin" href="/app">
            Sign in <ArrowRight size={15} />
          </Link>
        </div>
      </header>

      <section className="public-hero">
        <div className="public-hero-copy">
          <span className="eyebrow">CONFIDENTIAL PRIZE SAVINGS · SEPOLIA PREVIEW</span>
          <h1>Private saving should feel like saving.</h1>
          <p>
            Veilpot gives you pots, exact Autopilot schedules, private draw outcomes, and clear
            wallet controls without turning ordinary financial actions into a crypto obstacle
            course.
          </p>
          <div className="public-hero-actions">
            <Link className="primary-button" href="/app">
              Open Veilpot <ArrowRight size={16} />
            </Link>
            <a className="text-button" href="#how">
              See how it works <ChevronRight size={15} />
            </a>
          </div>
        </div>
        <aside className="public-account-preview">
          <header>
            <span>PRODUCT PREVIEW</span>
            <span className="status-pill">
              <i /> Preview
            </span>
          </header>
          <div className="public-preview-balance">
            <span>Private savings</span>
            <strong>Hidden until you reveal</strong>
            <div className="preview-mask">
              <i />
              <i />
              <i />
            </div>
          </div>
          <div className="public-preview-next">
            <CircleCheck size={18} />
            <div>
              <strong>Private by default</strong>
              <span>Illustrative interface · not connected wallet state</span>
            </div>
          </div>
          <div className="public-preview-grid">
            <div>
              <span>Live balances</span>
              <strong>Not inferred</strong>
            </div>
            <div>
              <span>Account state</span>
              <strong>On demand</strong>
            </div>
          </div>
        </aside>
      </section>

      <section className="public-trust-line">
        <span>
          <ShieldCheck size={16} /> Explicit wallet approval
        </span>
        <span>
          <LockKeyhole size={16} /> No automatic decryption
        </span>
        <span>
          <WalletCards size={16} /> No standing keeper custody
        </span>
        <span>Ethereum Sepolia · test environment</span>
      </section>

      <section className="public-section" id="how">
        <header>
          <span className="eyebrow">HOW VEILPOT WORKS</span>
          <h2>A financial routine, not a dashboard ritual.</h2>
          <p>Every important action is understandable before the wallet appears.</p>
        </header>
        <div className="public-step-grid">
          <article>
            <span>01</span>
            <LockKeyhole size={20} />
            <h3>Save privately</h3>
            <p>Choose an amount without publishing it as account metadata.</p>
          </article>
          <article>
            <span>02</span>
            <CalendarClock size={20} />
            <h3>Set the rhythm</h3>
            <p>Approve exact contribution windows and a bounded lifetime authorization.</p>
          </article>
          <article>
            <span>03</span>
            <Gift size={20} />
            <h3>Enter VeilDraw</h3>
            <p>
              Your saving activity can participate without turning the experience into casino UI.
            </p>
          </article>
          <article>
            <span>04</span>
            <ShieldCheck size={20} />
            <h3>Reveal only when ready</h3>
            <p>Private results and values remain user-initiated disclosures.</p>
          </article>
        </div>
      </section>

      <section className="public-section two-column" id="privacy">
        <div>
          <span className="eyebrow">PRIVACY AS A CONTROL</span>
          <h2>You should know what is private before you click.</h2>
          <p>
            Veilpot separates connection, sign-in, transaction approval, confidential settlement,
            and reveal into distinct states. That makes privacy understandable instead of magical.
          </p>
        </div>
        <div className="public-control-list">
          <div>
            <span>Balance</span>
            <strong>Hidden by default</strong>
          </div>
          <div>
            <span>Draw result</span>
            <strong>Explicit reveal</strong>
          </div>
          <div>
            <span>Notifications</span>
            <strong>Private wording</strong>
          </div>
          <div>
            <span>Keeper authority</span>
            <strong>Execution only</strong>
          </div>
        </div>
      </section>

      <section className="public-section" id="trust">
        <header>
          <span className="eyebrow">TRUST CENTER</span>
          <h2>What you should be able to verify.</h2>
        </header>
        <div className="public-principles">
          {principles.map((principle) => (
            <article key={principle.title}>
              <ShieldCheck size={18} />
              <h3>{principle.title}</h3>
              <p>{principle.body}</p>
            </article>
          ))}
        </div>
        <div className="public-testnet-disclosure">
          <strong>This is a Sepolia testnet experience.</strong>
          <span>
            The current integration uses Zama mock confidential tokens and simulated yield. It is
            not presented as production mainnet USDT or production yield.
          </span>
        </div>
      </section>

      <section className="public-contact" id="help">
        <div>
          <span className="eyebrow">NEED HELP?</span>
          <h2>Support should be easy to find before money moves.</h2>
          <p>
            Learn how Veilpot works, troubleshoot a wallet, understand a pending settlement, or
            report a security concern from one clear support surface.
          </p>
        </div>
        <div className="public-contact-links">
          <a href="#how">
            How Veilpot works <ChevronRight size={15} />
          </a>
          <a href="/app">
            Help center <ChevronRight size={15} />
          </a>
          <a href="#trust">
            Security & trust <ChevronRight size={15} />
          </a>
          <a href="mailto:support@veilpot.app">
            Contact <ChevronRight size={15} />
          </a>
        </div>
      </section>

      <section className="public-legal-strip" id="terms">
        <div>
          <strong>Terms & environment</strong>
          <span>
            Veilpot is currently a Sepolia testnet application using Zama test assets and simulated
            yield.
          </span>
        </div>
        <a href="#trust">
          Review trust disclosures <ChevronRight size={15} />
        </a>
      </section>
      <section className="public-legal-strip" id="status">
        <div>
          <strong>Application status</strong>
          <span>
            This interface targets the frozen Veilpot Sepolia deployment. Network availability
            depends on Ethereum Sepolia and Zama infrastructure.
          </span>
        </div>
        <Link href="/app">
          Open account <ChevronRight size={15} />
        </Link>
      </section>

      <footer className="public-human-footer">
        <VeilpotMark compact />
        <span>Private savings on Ethereum Sepolia</span>
        <nav>
          <a href="#privacy">Privacy</a>
          <a href="#terms">Terms</a>
          <a href="#security">Security</a>
          <a href="#status">Status</a>
        </nav>
      </footer>
    </main>
  );
}
