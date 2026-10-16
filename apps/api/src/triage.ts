/**
 * Emergency screening (server-enforced). The patient is asked about red-flag symptoms before booking; any positive answer,
 * or an emergency phrase in the free-text reason, stops the booking and shows emergency instructions. Booking is never allowed
 * to proceed past a positive screen, whatever the client sends.
 *
 * CLINICAL SIGN-OFF REQUIRED: this list is a conservative starting set. A licensed clinician must review and own it
 * before production use (docs/product/08-adr-clinical-intake.md).
 */
export const RED_FLAGS: { key: string; label: string }[] = [
  { key: "chest_pain", label: "Chest pain, pressure or tightness" },
  { key: "breathing", label: "Severe trouble breathing or can't speak full sentences" },
  { key: "stroke", label: "Sudden weakness, numbness, facial droop, confusion or trouble speaking" },
  { key: "bleeding", label: "Bleeding that won't stop or a serious injury" },
  { key: "self_harm", label: "Thoughts of harming yourself or someone else" },
  { key: "unresponsive", label: "Fainting, seizure or being unresponsive" },
  { key: "allergic", label: "Swelling of the face or throat, or a severe allergic reaction" },
  { key: "overdose", label: "A possible overdose or poisoning" },
];
const KEYS = new Set(RED_FLAGS.map((f) => f.key));

const PHRASES = [
  /chest (pain|pressure|tightness)/i, /can'?t breathe|cannot breathe|trouble breathing|short(ness)? of breath/i, /\bstroke\b|face droop|slurred speech/i,
  /suicid|kill (myself|him|her|them)|end my life|self[- ]harm|hurt myself/i, /overdos|poison/i, /heart attack/i, /unconscious|unresponsive|seizure/i,
  /severe bleeding|won'?t stop bleeding|anaphyla/i,
];

export interface Screen { emergency: boolean; message?: string; screened: boolean }

export const EMERGENCY_MESSAGE =
  "Based on your answers, this may be an emergency. Do not book online: call 911 now or go to the nearest emergency room. " +
  "If you are thinking about harming yourself, call or text 988 (Suicide & Crisis Lifeline) right away.";

/** `flags` must be present (possibly empty) when screening is required; absent means the patient was never asked. */
export function screen(reason: string | undefined, flags: string[] | undefined): Screen {
  if (flags === undefined) return { emergency: false, screened: false };
  if (flags.some((f) => KEYS.has(f)) || (reason && PHRASES.some((p) => p.test(reason)))) return { emergency: true, screened: true, message: EMERGENCY_MESSAGE };
  return { emergency: false, screened: true };
}
