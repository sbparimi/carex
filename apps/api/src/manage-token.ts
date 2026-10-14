// Stateless, unforgeable "manage this appointment" tokens for guests (ADR-002).
import { createHmac, timingSafeEqual } from "node:crypto";

const MIN_SECRET_LENGTH = 32;
const DOMAIN = "carex:manage-token:v1";

// Length-prefixed fields make (tenantId, bookingId) encoding unambiguous.
function encode(tenantId: string, bookingId: string): string {
  return `${DOMAIN}|${tenantId.length}:${tenantId}|${bookingId.length}:${bookingId}`;
}

function mac(secret: string, tenantId: string, bookingId: string): Buffer {
  return createHmac("sha256", secret).update(encode(tenantId, bookingId), "utf8").digest();
}

export function issueManageToken(secret: string, tenantId: string, bookingId: string): string {
  if (typeof secret !== "string" || secret.length < MIN_SECRET_LENGTH) {
    throw new Error(`manage-token secret must be at least ${MIN_SECRET_LENGTH} characters`);
  }
  return mac(secret, tenantId, bookingId).toString("base64url");
}

export function verifyManageToken(
  secret: string,
  tenantId: string,
  bookingId: string,
  token: string | undefined,
): boolean {
  try {
    if (typeof token !== "string" || token.length !== 43) return false;
    const expected = Buffer.from(issueManageToken(secret, tenantId, bookingId), "utf8");
    const given = Buffer.from(token, "utf8");
    if (given.length !== expected.length) return false;
    return timingSafeEqual(given, expected);
  } catch {
    return false;
  }
}
