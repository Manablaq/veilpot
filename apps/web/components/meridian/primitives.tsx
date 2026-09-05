import { AlertTriangle, ExternalLink, Info, LockKeyhole, ShieldCheck } from "lucide-react";
import type { ButtonHTMLAttributes, DetailsHTMLAttributes, HTMLAttributes, ReactNode } from "react";

function classNames(...values: (string | false | null | undefined)[]): string {
  return values
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ");
}

interface SurfaceProps extends HTMLAttributes<HTMLDivElement> {
  readonly elevation?: "base" | "raised" | "interactive";
}

export function Surface({ elevation = "base", className, ...props }: SurfaceProps) {
  return (
    <div className={classNames("vp-surface", className)} data-elevation={elevation} {...props} />
  );
}

export function Panel({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={classNames("vp-panel", className)} {...props} />;
}

export type MeridianButtonVariant = "primary" | "private" | "secondary" | "tertiary" | "danger";

interface MeridianButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: MeridianButtonVariant;
  readonly size?: "small" | "normal" | "large";
}

export function MeridianButton({
  variant = "secondary",
  size = "normal",
  type = "button",
  className,
  ...props
}: MeridianButtonProps) {
  return (
    <button
      type={type}
      className={classNames("vp-button", className)}
      data-variant={variant}
      data-size={size}
      {...props}
    />
  );
}

export function ProtocolBadge({
  children,
  className,
}: Readonly<{
  children: ReactNode;
  className?: string;
}>) {
  return (
    <span className={classNames("vp-badge", className)} data-kind="protocol">
      <ShieldCheck size={13} aria-hidden="true" />
      {children}
    </span>
  );
}

export function HumanActionBadge({
  children,
  className,
}: Readonly<{
  children: ReactNode;
  className?: string;
}>) {
  return (
    <span className={classNames("vp-badge", className)} data-kind="human">
      <LockKeyhole size={13} aria-hidden="true" />
      {children}
    </span>
  );
}

export function StatusBadge({
  children,
  tone = "neutral",
  className,
}: Readonly<{
  children: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger" | "information";
  className?: string;
}>) {
  return (
    <span className={classNames("vp-status-badge", className)} data-tone={tone}>
      {children}
    </span>
  );
}

export function InlineNotice({
  title,
  children,
  tone = "protocol",
  className,
}: Readonly<{
  title: string;
  children: ReactNode;
  tone?: "protocol" | "private" | "warning" | "danger";
  className?: string;
}>) {
  const Icon =
    tone === "warning" || tone === "danger"
      ? AlertTriangle
      : tone === "private"
        ? LockKeyhole
        : Info;

  return (
    <div
      className={classNames("vp-inline-notice", className)}
      data-tone={tone}
      role={tone === "danger" ? "alert" : "status"}
    >
      <Icon size={18} aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        <div>{children}</div>
      </div>
    </div>
  );
}

export function AddressText({
  children,
  className,
}: Readonly<{
  children: ReactNode;
  className?: string;
}>) {
  return <span className={classNames("vp-address", className)}>{children}</span>;
}

export function ExplorerLink({
  href,
  children = "Explorer",
  className,
}: Readonly<{
  href: string;
  children?: ReactNode;
  className?: string;
}>) {
  return (
    <a
      className={classNames("vp-explorer-link", className)}
      href={href}
      target="_blank"
      rel="noreferrer"
    >
      {children}
      <ExternalLink size={14} aria-hidden="true" />
    </a>
  );
}

interface TechnicalDisclosureProps extends DetailsHTMLAttributes<HTMLDetailsElement> {
  readonly label?: string;
}

export function TechnicalDisclosure({
  label = "Show technical details",
  children,
  className,
  ...props
}: TechnicalDisclosureProps) {
  return (
    <details className={classNames("vp-technical-disclosure", className)} {...props}>
      <summary>{label}</summary>
      <div>{children}</div>
    </details>
  );
}

export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={classNames("vp-skeleton", className)} aria-hidden="true" {...props} />;
}
