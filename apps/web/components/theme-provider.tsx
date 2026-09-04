"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type ThemeMode = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

interface ThemeContextValue {
  readonly mode: ThemeMode;
  readonly resolvedTheme: ResolvedTheme;
  readonly setMode: (mode: ThemeMode) => void;
}

const STORAGE_KEY = "veilpot-theme";
const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === "system" ? getSystemTheme() : mode;
}

export function ThemeProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [mode, setModeState] = useState<ThemeMode>("system");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light");

  const apply = useCallback((nextMode: ThemeMode) => {
    const nextResolved = resolveTheme(nextMode);
    document.documentElement.dataset.theme = nextResolved;
    document.documentElement.dataset.themeMode = nextMode;
    document.documentElement.style.colorScheme = nextResolved;
    setResolvedTheme(nextResolved);
  }, []);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const nextMode: ThemeMode =
      stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
    setModeState(nextMode);
    apply(nextMode);
  }, [apply]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (mode === "system") apply("system");
    };
    media.addEventListener("change", onChange);
    return () => {
      media.removeEventListener("change", onChange);
    };
  }, [apply, mode]);

  const setMode = useCallback(
    (nextMode: ThemeMode) => {
      window.localStorage.setItem(STORAGE_KEY, nextMode);
      setModeState(nextMode);
      apply(nextMode);
    },
    [apply],
  );

  const value = useMemo(() => ({ mode, resolvedTheme, setMode }), [mode, resolvedTheme, setMode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("useTheme must be used within ThemeProvider");
  return value;
}
