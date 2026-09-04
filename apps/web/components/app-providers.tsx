"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ZamaProvider } from "@zama-fhe/react-sdk";
import { type ReactNode, useState } from "react";
import { WagmiProvider } from "wagmi";

import { ThemeProvider } from "@/components/theme-provider";
import { veilpotWagmiConfig } from "@/lib/wagmi";
import { veilpotZamaConfig } from "@/lib/zama";

export function AppProviders({ children }: Readonly<{ children: ReactNode }>) {
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={veilpotWagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ZamaProvider config={veilpotZamaConfig}>
          <ThemeProvider>{children}</ThemeProvider>
        </ZamaProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
