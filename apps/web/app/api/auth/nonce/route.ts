import { randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import { isSecureExternalRequest } from "@/lib/request-origin";

const NONCE_COOKIE = "veilpot_siwe_nonce";

export function GET(request: Request) {
  const nonce = randomBytes(18).toString("base64url").replace(/[-_]/g, "A");
  const response = NextResponse.json({ nonce }, { headers: { "Cache-Control": "no-store" } });
  const secure = isSecureExternalRequest(request);

  response.cookies.set(NONCE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: "strict",
    secure,
    path: "/",
    maxAge: 10 * 60,
  });

  return response;
}
