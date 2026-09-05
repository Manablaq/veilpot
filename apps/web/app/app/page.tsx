import type { Metadata } from "next";

import { MeridianAppShell } from "@/components/meridian/app-shell";

export const metadata: Metadata = {
  title: "Private account",
  description: "Veilpot Meridian private savings account on Ethereum Sepolia.",
};

export default function AccountPage() {
  return <MeridianAppShell />;
}
