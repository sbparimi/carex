/** Journey selections and the navigation rule: changing an upstream choice invalidates incompatible downstream ones (PRD §5). */
export interface Selection {
  stateCode?: string; clinicId?: string; serviceId?: string; providerId?: string; slotId?: string;
}
export type Step = "stateCode" | "clinicId" | "serviceId" | "providerId" | "slotId";
const ORDER: Step[] = ["stateCode", "clinicId", "serviceId", "providerId", "slotId"];

/**
 * Apply a change. Downstream values survive only if `stillValid` explicitly revalidates them
 * (FR-004); otherwise they are cleared. The UI must never silently keep a stale provider or slot.
 */
export function applySelection(
  current: Selection, step: Step, value: string | undefined,
  stillValid: (downstream: Step, value: string, next: Selection) => boolean = () => false,
): Selection {
  if (current[step] === value) return { ...current };
  const next: Selection = { ...current };
  if (value === undefined) delete next[step]; else next[step] = value;
  for (const s of ORDER.slice(ORDER.indexOf(step) + 1)) {
    const v = next[s];
    if (v !== undefined && !stillValid(s, v, next)) delete next[s];
  }
  return next;
}

/** A provider's slot is only valid while its own provider is selected; used by callers revalidating slots. */
export const isComplete = (s: Selection): s is Required<Selection> => ORDER.every((k) => s[k] !== undefined);
