import { NextResponse } from "next/server";

import { isSameRequestOrigin, isSecureExternalRequest } from "@/lib/request-origin";

const COOKIES = [
  "veilpot_siwe_nonce",
  "veilpot_session_message",
  "veilpot_session_signature",
] as const;

export function POST(request: Request) {
  if (!isSameRequestOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  }

  const secure = isSecureExternalRequest(request);

  const response = NextResponse.json({ ok: true });
  for (const name of COOKIES) {
    response.cookies.set(name, "", {
      httpOnly: true,
      sameSite: "strict",
      secure,
      path: "/",
      maxAge: 0,
    });
  }
  return response;
}
