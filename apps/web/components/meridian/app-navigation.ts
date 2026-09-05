import {
  Activity,
  CalendarClock,
  Gift,
  Home,
  LockKeyhole,
  Settings,
  ShieldCheck,
  WalletCards,
  type LucideIcon,
} from "lucide-react";

export type MeridianView =
  | "overview"
  | "save"
  | "autopilot"
  | "veildraw"
  | "activity"
  | "privacy"
  | "security"
  | "settings";

export interface MeridianNavigationItem {
  readonly view: MeridianView;
  readonly label: string;
  readonly shortLabel: string;
  readonly description: string;
  readonly icon: LucideIcon;
}

export const MERIDIAN_NAV_ITEMS: readonly MeridianNavigationItem[] = [
  {
    view: "overview",
    label: "Overview",
    shortLabel: "Overview",
    description: "Private position, protocol context and safe next actions.",
    icon: Home,
  },
  {
    view: "save",
    label: "Save",
    shortLabel: "Save",
    description: "Registration, confidential deposits, withdrawals and recovery.",
    icon: WalletCards,
  },
  {
    view: "autopilot",
    label: "Autopilot",
    shortLabel: "Autopilot",
    description: "Bounded private saving schedules and execution controls.",
    icon: CalendarClock,
  },
  {
    view: "veildraw",
    label: "VeilDraw",
    shortLabel: "VeilDraw",
    description: "Private participation across the public three-prize draw lifecycle.",
    icon: Gift,
  },
  {
    view: "activity",
    label: "Activity",
    shortLabel: "Activity",
    description: "Public protocol activity without reconstructing confidential values.",
    icon: Activity,
  },
  {
    view: "privacy",
    label: "Privacy",
    shortLabel: "Privacy",
    description: "Privacy Shield, reveal boundaries and private-data controls.",
    icon: LockKeyhole,
  },
  {
    view: "security",
    label: "Security",
    shortLabel: "Security",
    description: "Network, contract identities, authority boundaries and recovery.",
    icon: ShieldCheck,
  },
  {
    view: "settings",
    label: "Settings",
    shortLabel: "Settings",
    description: "Appearance, accessibility, wallet access and application preferences.",
    icon: Settings,
  },
] as const;

export function meridianNavigationItem(view: MeridianView): MeridianNavigationItem {
  const match = MERIDIAN_NAV_ITEMS.find((item) => item.view === view);

  if (match === undefined) {
    throw new Error(`Unknown Meridian view: ${view}`);
  }

  return match;
}
