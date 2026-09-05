const TRANSPORT_MARKERS = [
  "http request failed",
  "failed to fetch",
  "rpc request failed",
  "network request failed",
  "fetch failed",
  "rpc.thirdweb.com",
  "request timeout",
  "timed out",
] as const;

const TECHNICAL_MARKERS = [
  "request arguments:",
  "raw call arguments:",
  "contract call:",
  "docs:",
  "version:",
  "url:",
  "request body:",
] as const;

function normalizedMessage(error: Error): string {
  return error.message.replace(/\s+/g, " ").trim();
}

function containsMarker(value: string, markers: readonly string[]): boolean {
  const lower = value.toLowerCase();
  return markers.some((marker) => lower.includes(marker));
}

export function toUserFacingError(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) {
    return fallback;
  }

  const message = normalizedMessage(error);

  if (message.length === 0) {
    return fallback;
  }

  const lower = message.toLowerCase();

  if (
    lower.includes("user rejected") ||
    lower.includes("user denied") ||
    lower.includes("request rejected")
  ) {
    return "The wallet request was cancelled. Nothing was submitted.";
  }

  if (containsMarker(message, TRANSPORT_MARKERS)) {
    return (
      "Sepolia could not be reached just now. Live state was not changed " +
      "and no transaction was prepared. Refresh again in a moment."
    );
  }

  if (message.length <= 280 && !containsMarker(message, TECHNICAL_MARKERS)) {
    return message;
  }

  const firstSentence = /^(.{1,220}?[.!?])(?:\s|$)/.exec(message)?.[1]?.trim();

  if (firstSentence !== undefined && !containsMarker(firstSentence, TECHNICAL_MARKERS)) {
    return firstSentence;
  }

  return fallback;
}
