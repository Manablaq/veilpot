"use client";

import { Eye, EyeOff, LockKeyhole } from "lucide-react";
import { useState } from "react";

interface PrivacyValueProps {
  readonly value: string;
  readonly label: string;
  readonly masked?: string;
  readonly large?: boolean;
  readonly compact?: boolean;
}

export function PrivacyValue({
  value,
  label,
  masked = "Private",
  large = false,
  compact = false,
}: PrivacyValueProps) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div
      className={`privacy-value ${large ? "privacy-value-large" : ""} ${compact ? "privacy-value-compact" : ""}`.trim()}
    >
      <div className="privacy-value-toolbar">
        <span>
          <LockKeyhole size={13} /> {revealed ? "Temporarily visible" : "Encrypted"}
        </span>
        <button
          type="button"
          onClick={() => {
            setRevealed((current) => !current);
          }}
          aria-label={revealed ? `Hide ${label}` : `Reveal ${label}`}
          aria-pressed={revealed}
        >
          {revealed ? <EyeOff size={15} /> : <Eye size={15} />}
          {revealed ? "Hide" : "Reveal"}
        </button>
      </div>

      <div
        className={revealed ? "privacy-value-display revealed" : "privacy-value-display masked"}
        aria-live="polite"
      >
        {revealed ? (
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
