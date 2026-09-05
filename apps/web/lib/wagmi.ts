"use client";

import { fallback, http } from "viem";
import { createConfig } from "wagmi";
import { sepolia } from "wagmi/chains";

const configuredSepoliaRpc = process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL?.trim();

const sepoliaTransports = [
  ...(configuredSepoliaRpc
    ? [
        http(configuredSepoliaRpc, {
          retryCount: 1,
          timeout: 12_000,
        }),
      ]
    : []),
  http("https://ethereum-sepolia-rpc.publicnode.com", {
    retryCount: 1,
    timeout: 12_000,
  }),
  http(),
];

export const veilpotWagmiConfig = createConfig({
  chains: [sepolia],
  multiInjectedProviderDiscovery: true,
  ssr: true,
  transports: {
    [sepolia.id]: fallback(sepoliaTransports, {
      rank: false,
    }),
  },
});
