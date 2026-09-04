import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createPublicClient, http, type Hex } from "viem";
import { sepolia } from "viem/chains";

import { parseVeilpotSiweMessage, VEILPOT_CHAIN_ID } from "@/lib/siwe";
import { resolveRequestOrigin } from "@/lib/request-origin";

const MESSAGE_COOKIE = "veilpot_session_message";
const SIGNATURE_COOKIE = "veilpot_session_signature";

function decodeSessionValue(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

export async function GET(request: Request) {
  const cookieStore = await cookies();
  const encodedMessage = cookieStore.get(MESSAGE_COOKIE)?.value;
  const encodedSignature = cookieStore.get(SIGNATURE_COOKIE)?.value;
  if (!encodedMessage || !encodedSignature) {
    return NextResponse.json(
      { authenticated: false },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const message = decodeSessionValue(encodedMessage);
    const signature = decodeSessionValue(encodedSignature);
    const fields = parseVeilpotSiweMessage(message);
    const requestOrigin = resolveRequestOrigin(request);
    const requestOriginUrl = new URL(requestOrigin);

    if (
      fields.domain !== requestOriginUrl.host ||
      fields.uri !== requestOrigin ||
      fields.chainId !== VEILPOT_CHAIN_ID ||
      Date.parse(fields.expirationTime) <= Date.now()
    ) {
      throw new Error("Session binding expired.");
    }

    const publicClient = createPublicClient({
      chain: sepolia,
      transport: http(process.env.SEPOLIA_RPC_URL),
    });
    const valid = await publicClient.verifyMessage({
      address: fields.address,
      message,
      signature: signature as Hex,
    });
    if (!valid) throw new Error("Invalid session signature.");

    return NextResponse.json(
      {
        authenticated: true,
        address: fields.address,
        chainId: fields.chainId,
        expiresAt: fields.expirationTime,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    const response = NextResponse.json(
      { authenticated: false },
      { headers: { "Cache-Control": "no-store" } },
    );
    response.cookies.set(MESSAGE_COOKIE, "", { path: "/", maxAge: 0 });
    response.cookies.set(SIGNATURE_COOKIE, "", { path: "/", maxAge: 0 });
    return response;
  }
}
