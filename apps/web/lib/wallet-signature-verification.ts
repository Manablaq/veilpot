import {
  createPublicClient,
  http,
  isAddressEqual,
  recoverMessageAddress,
  type Address,
  type Hex,
} from "viem";
import { sepolia } from "viem/chains";

export const VEILPOT_SMART_ACCOUNT_VERIFY_TIMEOUT_MS = 6_000;

export interface VeilpotWalletSignatureInput {
  readonly address: Address;
  readonly message: string;
  readonly signature: Hex;
}

export type VeilpotSmartAccountVerifier = (input: VeilpotWalletSignatureInput) => Promise<boolean>;

async function verifySmartAccountSignature(input: VeilpotWalletSignatureInput): Promise<boolean> {
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(process.env.SEPOLIA_RPC_URL, {
      retryCount: 0,
      timeout: VEILPOT_SMART_ACCOUNT_VERIFY_TIMEOUT_MS,
    }),
  });

  return publicClient
    .verifyMessage({
      address: input.address,
      message: input.message,
      signature: input.signature,
    })
    .catch(() => false);
}

export async function verifyVeilpotWalletSignature(
  input: VeilpotWalletSignatureInput,
  verifySmartAccount: VeilpotSmartAccountVerifier = verifySmartAccountSignature,
): Promise<boolean> {
  try {
    const recovered = await recoverMessageAddress({
      message: input.message,
      signature: input.signature,
    });
    if (isAddressEqual(recovered, input.address)) return true;
  } catch {
    // A contract-account signature may not be recoverable as an EOA signature.
  }

  try {
    return await verifySmartAccount(input);
  } catch {
    return false;
  }
}
