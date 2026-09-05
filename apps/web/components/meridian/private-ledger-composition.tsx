"use client";

import { ArrowUpRight, CalendarClock, Grid3X3, LockKeyhole } from "lucide-react";
import { type PointerEvent as ReactPointerEvent, useState } from "react";

import styles from "@/app/meridian-home.module.css";
import { CipherRibbon, MeridianPrivateValue, ProtocolBadge } from "@/components/meridian";

const SCHEDULE_WINDOWS = ["FRI 08:00", "FRI 08:00", "FRI 08:00", "FRI 08:00"] as const;

const LATTICE_CELLS = Array.from({ length: 32 }, (_, index) => index);

interface Parallax {
  readonly x: number;
  readonly y: number;
  readonly active: boolean;
}

const RESTING_PARALLAX: Parallax = {
  x: 0,
  y: 0,
  active: false,
};

export function PrivateLedgerComposition() {
  const [parallax, setParallax] = useState<Parallax>(RESTING_PARALLAX);

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "mouse") return;

    const bounds = event.currentTarget.getBoundingClientRect();

    const x = ((event.clientX - bounds.left) / bounds.width - 0.5) * 12;

    const y = ((event.clientY - bounds.top) / bounds.height - 0.5) * 12;

    setParallax({
      x,
      y,
      active: true,
    });
  };

  const reset = () => {
    setParallax(RESTING_PARALLAX);
  };

  const frontTransform = `translate3d(${String(parallax.x)}px, ${String(
    parallax.y - (parallax.active ? 4 : 0),
  )}px, 0) rotateX(2deg) rotateY(-3deg)`;

  const scheduleTransform = `translate3d(${String(
    18 - parallax.x * 0.35,
  )}px, ${String(-22 + parallax.y * 0.28)}px, 0) rotate(-2deg)`;

  const drawTransform = `translate3d(${String(
    -10 + parallax.x * 0.2,
  )}px, ${String(-43 - parallax.y * 0.2)}px, 0) rotate(2deg)`;

  return (
    <div
      className={`${styles.ledgerStage} ${parallax.active ? styles.ledgerStageActive : ""}`}
      onPointerMove={handlePointerMove}
      onPointerLeave={reset}
      aria-label="Private Ledger Composition"
    >
      <div
        className={`${styles.ledgerLayer} ${styles.drawLedger}`}
        style={{
          transform: drawTransform,
        }}
      >
        <header>
          <span>
            <Grid3X3 size={13} aria-hidden="true" />
            VEILDRAW FIELD
          </span>
          <ProtocolBadge>Private selection</ProtocolBadge>
        </header>

        <div className={styles.miniLattice} aria-hidden="true">
          {LATTICE_CELLS.map((cell) => (
            <i key={cell} />
          ))}
        </div>

        <footer>
          <span>Snapshot lifecycle</span>
          <strong>Public finality</strong>
        </footer>
      </div>

      <div
        className={`${styles.ledgerLayer} ${styles.scheduleLedger}`}
        style={{
          transform: scheduleTransform,
        }}
      >
        <header>
          <span>
            <CalendarClock size={13} aria-hidden="true" />
            AUTOPILOT
          </span>
          <span>Bounded authority</span>
        </header>

        <div className={styles.miniSchedule}>
          {SCHEDULE_WINDOWS.map((window, index) => (
            <div key={`${window}-${String(index)}`}>
              <i aria-hidden="true" />
              <span>{window}</span>
            </div>
          ))}
        </div>

        <footer>
          Lifetime authorization
          <span aria-hidden="true">↤ bounded ↦</span>
        </footer>
      </div>

      <div
        className={`${styles.ledgerLayer} ${styles.positionLedger}`}
        style={{
          transform: frontTransform,
        }}
      >
        <header>
          <div>
            <span>PRIVATE POSITION</span>
            <small>Confidential principal</small>
          </div>

          <span className={styles.encryptedState}>
            <LockKeyhole size={12} aria-hidden="true" />
            Encrypted
          </span>
        </header>

        <MeridianPrivateValue
          label="Private principal"
          state="sealed"
          detail="Never revealed automatically"
        />

        <dl className={styles.positionFacts}>
          <div>
            <dt>Participant</dt>
            <dd>Session required</dd>
          </div>

          <div>
            <dt>Next action</dt>
            <dd>
              Open Veilpot
              <ArrowUpRight size={12} aria-hidden="true" />
            </dd>
          </div>
        </dl>

        <div className={styles.ledgerRibbon}>
          <CipherRibbon quiet={!parallax.active} />
        </div>
      </div>

      <span className={styles.ledgerAmbientLabel} aria-hidden="true">
        PRIVATE CAPITAL IN MOTION
      </span>
    </div>
  );
}
