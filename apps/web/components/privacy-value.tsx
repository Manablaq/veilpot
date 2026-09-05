"use client";

import { Eye, EyeOff, LockKeyhole } from "lucide-react";
import { useState } from "react";

interface PrivacyValueProps {
  readonly value: string;
  readonly label: string;
  readonly masked?: string;
  readonly large?: boolean;
  readonly compact?: boolean;
  readonly revealable?: boolean;
}

export function PrivacyValue({
  value,
  label,
  masked = "Private",
  large = false,
  compact = false,
  revealable = true,
}: PrivacyValueProps) {
  const [revealed, setRevealed] = useState(false);
  const visible = revealable && revealed;

  return (
    <div
      className={`privacy-value ${large ? "privacy-value-large" : ""} ${compact ? "privacy-value-compact" : ""}`.trim()}
    >
      <div className="privacy-value-toolbar">
        <span>
          <LockKeyhole size={13} />{" "}
          {visible ? "Temporarily visible" : revealable ? "Encrypted" : "Encrypted · not decrypted"}
        </span>
        {revealable ? (
          <button
            type="button"
            onClick={() => {
              setRevealed((current) => !current);
            }}
            aria-label={visible ? `Hide ${label}` : `Reveal ${label}`}
            aria-pressed={visible}
          >
            {visible ? <EyeOff size={15} /> : <Eye size={15} />}
            {visible ? "Hide" : "Reveal"}
          </button>
        ) : null}
      </div>

      <div
        className={visible ? "privacy-value-display revealed" : "privacy-value-display masked"}
        aria-live="polite"
      >
        {visible ? (
          <strong>{value}</strong>
        ) : (
          <div className="privacy-mask-line" aria-hidden="true">
            <span>{masked}</span>
            <i />
            <i />
            <i />
          </div>
        )}
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}
