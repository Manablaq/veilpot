"use client";

import type { Address } from "viem";

import { PrizeClaimV2 } from "@/components/prize-claim-v2";
import { PrizeLifecycleV2 } from "@/components/prize-lifecycle-v2";

export function PrizeControlCenter({
  authenticatedAddress,
}: {
  readonly authenticatedAddress: Address;
}) {
  return (
    <>
      <PrizeLifecycleV2 authenticatedAddress={authenticatedAddress} />
      <PrizeClaimV2 authenticatedAddress={authenticatedAddress} />
    </>
  );
}
