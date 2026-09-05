import { LockKeyhole } from "lucide-react";
import type { ReactNode } from "react";

import { CipherMask } from "@/components/meridian/cipher-mask";

export type PrivateValueState = "sealed" | "revealed" | "unknown";

interface MeridianPrivateValueProps {
  readonly label?: string;
  readonly state: PrivateValueState;
  readonly value?: ReactNode;
  readonly detail?: string;
  readonly className?: string;
}

export function MeridianPrivateValue({
  label = "Private value",
  state,
  value,
  detail,
  className,
}: MeridianPrivateValueProps) {
  const hasAuthorizedValue = state === "revealed" && value !== null && value !== undefined;

  return (
    <span
      className={className ? `vp-private-value ${className}` : "vp-private-value"}
      data-state={hasAuthorizedValue ? "revealed" : state === "sealed" ? "sealed" : "unknown"}
      aria-live={hasAuthorizedValue ? "polite" : undefined}
    >
      <span className="vp-private-value-label">
        <LockKeyhole size={12} aria-hidden="true" />
        {label}
      </span>

      <span className="vp-private-value-content">
        {hasAuthorizedValue ? (
          value
        ) : state === "sealed" ? (
          <CipherMask />
        ) : (
          <span aria-label="Value unavailable">—</span>
        )}
      </span>

      {detail ? <span className="vp-private-value-detail">{detail}</span> : null}
    </span>
  );
}
