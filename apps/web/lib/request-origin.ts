function firstForwardedValue(value: string | null): string | null {
  if (value === null) return null;
  const first = value.split(",", 1)[0]?.trim();
  return first && first.length > 0 ? first : null;
}

function configuredOrigin(): string | null {
  const configured = process.env.VEILPOT_APP_ORIGIN?.trim();
  if (!configured) return null;

  const parsed = new URL(configured);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("VEILPOT_APP_ORIGIN must use http or https.");
  }
  return parsed.origin;
}

export function resolveRequestOrigin(request: Request): string {
  const configured = configuredOrigin();
  if (configured) return configured;

  const requestUrl = new URL(request.url);
  const forwardedHost = firstForwardedValue(request.headers.get("x-forwarded-host"));
  const forwardedProto = firstForwardedValue(request.headers.get("x-forwarded-proto"));
  const directHost = firstForwardedValue(request.headers.get("host"));

  const host = forwardedHost ?? directHost ?? requestUrl.host;
  const protocol = forwardedProto ?? requestUrl.protocol.replace(/:$/, "");

  if (protocol !== "http" && protocol !== "https") {
    throw new Error("Unsupported request protocol.");
  }

  return `${protocol}://${host}`;
}

export function isSameRequestOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return true;

  try {
    return new URL(origin).origin === resolveRequestOrigin(request);
  } catch {
    return false;
  }
}

export function isSecureExternalRequest(request: Request): boolean {
  return new URL(resolveRequestOrigin(request)).protocol === "https:";
}
