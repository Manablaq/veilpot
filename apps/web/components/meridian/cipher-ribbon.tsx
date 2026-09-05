interface CipherRibbonProps {
  readonly direction?: "forward" | "reverse";
  readonly quiet?: boolean;
  readonly className?: string;
}

const CELLS = Array.from({ length: 24 }, (_, index) => index);

export function CipherRibbon({
  direction = "forward",
  quiet = false,
  className,
}: CipherRibbonProps) {
  return (
    <span
      className={className ? `vp-cipher-ribbon ${className}` : "vp-cipher-ribbon"}
      data-direction={direction}
      data-quiet={quiet ? "true" : "false"}
      aria-hidden="true"
    >
      {CELLS.map((cell) => (
        <i key={cell} />
      ))}
    </span>
  );
}
