import { VEILPOT_SEPOLIA_DEPLOYMENT } from "@veilpot/protocol-sdk";

export const PRODUCT = {
  network: "Ethereum Sepolia",
  privacyMessage: "Private by default. Reveal only when you choose.",
  deployment: {
    pool: VEILPOT_SEPOLIA_DEPLOYMENT.pool,
    vault: VEILPOT_SEPOLIA_DEPLOYMENT.vault,
    adapter: VEILPOT_SEPOLIA_DEPLOYMENT.adapter,
    reserve: VEILPOT_SEPOLIA_DEPLOYMENT.reserve,
  },
} as const;

export const PLAN_PRESETS = [
  {
    id: "daily",
    label: "Daily",
    rhythm: "Every day",
    microcopy: "Small private deposits, committed to exact daily windows.",
    windows: [72, 42, 62, 36, 78, 48, 68, 54, 82, 44, 70, 58],
  },
  {
    id: "weekly",
    label: "Weekly",
    rhythm: "Every Friday",
    microcopy: "One dependable contribution window every week.",
    windows: [22, 24, 26, 30, 88, 28, 24, 26, 30, 82, 28, 24],
  },
  {
    id: "monthly",
    label: "Monthly",
    rhythm: "A calendar date you choose",
    microcopy: "Real calendar dates — never an approximate 30-day loop.",
    windows: [18, 20, 22, 88, 20, 18, 22, 24, 82, 20, 18, 22],
  },
  {
    id: "custom",
    label: "Custom",
    rhythm: "Exact private windows",
    microcopy: "Build a non-overlapping schedule that matches your life.",
    windows: [82, 26, 48, 22, 72, 34, 56, 28, 88, 40, 64, 30],
  },
] as const;

export type PlanPreset = (typeof PLAN_PRESETS)[number];

// Non-authoritative presentation fixtures.
// These values must only render inside UI that is visibly labelled as a product preview.
export const PRODUCT_PREVIEW_PLANS = [
  {
    id: "emergency",
    name: "Emergency fund · preview",
    cadence: "Sample weekly schedule",
    progress: 78,
    runway: 5,
    next: "Sample window",
    completed: 11,
    scheduled: 14,
    tone: "mint",
    windows: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0],
  },
  {
    id: "special",
    name: "Something special · preview",
    cadence: "Sample monthly schedule",
    progress: 41,
    runway: 3,
    next: "Sample window",
    completed: 5,
    scheduled: 12,
    tone: "violet",
    windows: [1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0],
  },
] as const;

// Non-authoritative presentation fixtures.
// Never present these rows as wallet or on-chain transaction history.
export const PRODUCT_PREVIEW_ACTIVITY = [
  {
    title: "Autopilot contribution · preview",
    detail: "Example settled event · not wallet history",
    time: "Preview",
    state: "settled",
  },
  {
    title: "VeilDraw lifecycle · preview",
    detail: "Example private-finalization event · not live draw state",
    time: "Preview",
    state: "pending",
  },
  {
    title: "Plan funding · preview",
    detail: "Example vault-funding event · not wallet history",
    time: "Preview",
    state: "settled",
  },
] as const;

export const TRUST_FACTS = [
  { value: "4", label: "frozen protocol contracts", note: "Pool · Vault · Adapter · Reserve" },
  {
    value: "0",
    label: "standing keeper wallet approvals",
    note: "permissionless execution, not custody",
  },
  {
    value: "330",
    label: "regression tests in the frozen baseline",
    note: "102 reference · 212 contract · 16 SDK",
  },
  {
    value: "1",
    label: "person who decides when private data is revealed",
    note: "the authorized user",
  },
] as const;
