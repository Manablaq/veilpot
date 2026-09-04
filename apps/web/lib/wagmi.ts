"use client";

import { createConfig, http } from "wagmi";
import { sepolia } from "wagmi/chains";

export const veilpotWagmiConfig = createConfig({
  chains: [sepolia],
  multiInjectedProviderDiscovery: true,
  ssr: true,
  transports: {
    [sepolia.id]: http(),
  },
});
