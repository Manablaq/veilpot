import Link from "next/link";

export function VeilpotMark({ compact = false }: Readonly<{ compact?: boolean }>) {
  return (
    <Link className="brand" href="/" aria-label="Veilpot home">
      <span className="veilpot-symbol" aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <i />
      </span>
      {!compact && <span className="brand-word">veilpot</span>}
    </Link>
  );
}

export function NetworkPill() {
  return (
    <span className="network-pill">
      <span className="status-dot" />
      Sepolia
    </span>
  );
}
