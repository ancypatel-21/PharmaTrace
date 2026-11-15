// Links encoded in batch QR codes (V4). Each QR opens the public verify page for one batch.

import { isLoopbackHost } from "./config.js";

/**
 * Base URL the QR codes point to: VITE_PUBLIC_URL if set (e.g. the LAN address during the
 * local demo, or the hosted app), otherwise the address this page was opened from.
 */
export function publicBaseUrl(
  configured = import.meta.env.VITE_PUBLIC_URL,
  origin = typeof window !== "undefined" ? window.location.origin : "",
) {
  return String(configured || origin).replace(/\/+$/, "");
}

/** Deep link to the verify page: "<base>/verify/<id>". */
export function verifyUrl(batchId, base = publicBaseUrl()) {
  return `${String(base).replace(/\/+$/, "")}/verify/${String(batchId)}`;
}

/** True when the link only works on this computer (localhost), so a phone can't open it. */
export function isLocalOnlyUrl(url) {
  try {
    return isLoopbackHost(new URL(url).hostname);
  } catch {
    return false;
  }
}
