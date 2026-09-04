import { createConfig as createZamaConfig } from "@zama-fhe/react-sdk/wagmi";
import { sepolia } from "@zama-fhe/sdk/chains";
import { web } from "@zama-fhe/sdk/web";

import { veilpotWagmiConfig } from "@/lib/wagmi";
import { publishZamaSdkEvent } from "@/lib/operator-approval";

export const veilpotZamaConfig = createZamaConfig({
  chains: [sepolia],
  wagmiConfig: veilpotWagmiConfig,
  relayers: {
    [sepolia.id]: web(),
  },
  onEvent: publishZamaSdkEvent,
});
