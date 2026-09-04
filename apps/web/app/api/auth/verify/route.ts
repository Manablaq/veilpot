import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createPublicClient, http, type Hex } from "viem";
import { sepolia } from "viem/chains";

import { parseVeilpotSiweMessage, VEILPOT_CHAIN_ID, VEILPOT_SESSION_TTL_MS } from "@/lib/siwe";
import {
  isSameRequestOrigin,
  isSecureExternalRequest,
  resolveRequestOrigin,
} from "@/lib/request-origin";

const NONCE_COOKIE = "veilpot_siwe_nonce";
const MESSAGE_COOKIE = "veilpot_session_message";
const SIGNATURE_COOKIE = "veilpot_session_signature";

function encodeSessionValue(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

export async function POST(request: Request) {
  if (!isSameRequestOrigin(request))
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });

  const body = (await request.json().catch(() => null)) as {
    message?: unknown;
    signature?: unknown;
  } | null;
  if (!body || typeof body.message !== "string" || typeof body.signature !== "string") {
    return NextResponse.json({ error: "Invalid sign-in payload." }, { status: 400 });
  }

  let fields;
  try {
    fields = parseVeilpotSiweMessage(body.message);
  } catch {
    return NextResponse.json({ error: "The sign-in message is malformed." }, { status: 400 });
  }

  const requestOrigin = resolveRequestOrigin(request);
  const requestOriginUrl = new URL(requestOrigin);
  if (fields.domain !== requestOriginUrl.host || fields.uri !== requestOrigin) {
    return NextResponse.json(
      { error: "The sign-in request does not match this Veilpot origin." },
      { status: 400 },
    );
  }
  if (fields.chainId !== VEILPOT_CHAIN_ID) {
    return NextResponse.json(
      { error: "Veilpot sign-in is currently bound to Ethereum Sepolia." },
      { status: 400 },
    );
  }

  const cookieStore = await cookies();
  const expectedNonce = cookieStore.get(NONCE_COOKIE)?.value;
  if (!expectedNonce || fields.nonce !== expectedNonce) {
    return NextResponse.json(
      { error: "This sign-in request expired. Please try again." },
      { status: 400 },
    );
  }

  const now = Date.now();
  const issuedAt = Date.parse(fields.issuedAt);
  const expirationTime = Date.parse(fields.expirationTime);
  if (
    issuedAt > now + 5 * 60 * 1000 ||
    expirationTime <= now ||
    expirationTime - issuedAt > VEILPOT_SESSION_TTL_MS + 60_000
  ) {
    return NextResponse.json(
      { error: "The sign-in timestamps are invalid or expired." },
      { status: 400 },
    );
  }

  if (!/^0x[0-9a-fA-F]+$/.test(body.signature)) {
    return NextResponse.json(
      { error: "The wallet returned an invalid signature." },
      { status: 400 },
    );
  }

  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(process.env.SEPOLIA_RPC_URL),
  });

  const valid = await publicClient
    .verifyMessage({
      address: fields.address,
      message: body.message,
      signature: body.signature as Hex,
    })
    .catch(() => false);

  if (!valid)
    return NextResponse.json({ error: "Wallet signature verification failed." }, { status: 401 });

  const secure = isSecureExternalRequest(request);
  const maxAge = Math.max(1, Math.floor((expirationTime - now) / 1000));
  const response = NextResponse.json({
    address: fields.address,
    chainId: fields.chainId,
    expiresAt: fields.expirationTime,
  });

  response.cookies.set(MESSAGE_COOKIE, encodeSessionValue(body.message), {
    httpOnly: true,
    sameSite: "strict",
    secure,
    path: "/",
    maxAge,
  });
  response.cookies.set(SIGNATURE_COOKIE, encodeSessionValue(body.signature), {
    httpOnly: true,
    sameSite: "strict",
    secure,
    path: "/",
    maxAge,
  });
  response.cookies.set(NONCE_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure,
    path: "/",
    maxAge: 0,
  });

  return response;
}
