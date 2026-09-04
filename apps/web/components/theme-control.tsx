"use client";

import { Laptop, Moon, Sun } from "lucide-react";

import { type ThemeMode, useTheme } from "@/components/theme-provider";

const options: readonly { mode: ThemeMode; label: string; icon: typeof Sun }[] = [
  { mode: "light", label: "Light", icon: Sun },
  { mode: "dark", label: "Dark", icon: Moon },
  { mode: "system", label: "System", icon: Laptop },
];

export function ThemeControl({ compact = false }: Readonly<{ compact?: boolean }>) {
  const { mode, setMode } = useTheme();

  return (
    <div
      className={compact ? "theme-control compact" : "theme-control"}
      role="group"
      aria-label="Appearance"
    >
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <button
            key={option.mode}
            type="button"
            className={mode === option.mode ? "active" : ""}
            aria-pressed={mode === option.mode}
            title={`${option.label} appearance`}
            onClick={() => {
              setMode(option.mode);
            }}
          >
            <Icon size={14} />
            {compact ? (
              <span className="sr-only">{option.label}</span>
            ) : (
              <span>{option.label}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
