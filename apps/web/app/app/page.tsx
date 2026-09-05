import type { Metadata } from "next";

import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  title: "Account",
  description: "Veilpot wallet-authenticated private savings account on Ethereum Sepolia.",
};

export default function AccountPage() {
  return <AppShell />;
}
