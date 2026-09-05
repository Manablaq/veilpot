"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import styles from "@/app/meridian-home.module.css";
import { VeilpotMark } from "@/components/brand";

const NAVIGATION = [
  ["Product", "#product"],
  ["Privacy", "#privacy"],
  ["Autopilot", "#autopilot"],
  ["VeilDraw", "#veildraw"],
  ["Security", "#security"],
] as const;

export function MeridianPublicNav() {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const sync = () => {
      setScrolled(window.scrollY >= 60);
    };

    sync();

    window.addEventListener("scroll", sync, {
      passive: true,
    });

    return () => {
      window.removeEventListener("scroll", sync);
    };
  }, []);

  return (
    <header className={`${styles.publicNav} ${scrolled ? styles.publicNavScrolled : ""}`}>
      <div className={styles.publicNavInner}>
        <VeilpotMark />

        <nav className={styles.publicNavCenter} aria-label="Public navigation">
          {NAVIGATION.map(([label, href]) => (
            <a key={href} href={href}>
              {label}
            </a>
          ))}
        </nav>

        <div className={styles.publicNavActions}>
          <span className={styles.navNetwork} aria-label="Ethereum Sepolia testnet">
            <i aria-hidden="true" />
            <span>Sepolia</span>
          </span>

          <Link
            className={`vp-button ${styles.navOpenButton}`}
            data-variant="primary"
            data-size="small"
            href="/app"
          >
            Open Veilpot
            <ArrowRight size={15} aria-hidden="true" />
          </Link>
        </div>
      </div>
    </header>
  );
}
