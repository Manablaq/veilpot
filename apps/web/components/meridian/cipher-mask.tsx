interface CipherMaskProps {
  readonly label?: string;
  readonly className?: string;
}

const CELLS = [0, 1, 2, 3, 4] as const;

export function CipherMask({ label = "Private value sealed", className }: CipherMaskProps) {
  return (
    <span
      className={className ? `vp-cipher-mask ${className}` : "vp-cipher-mask"}
      role="img"
      aria-label={label}
    >
      {CELLS.map((cell) => (
        <i key={cell} aria-hidden="true" />
      ))}
    </span>
  );
}
