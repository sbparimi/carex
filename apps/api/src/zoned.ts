// Time-zone maths using only Intl.DateTimeFormat (no dependencies).

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  weekday: number; // 0 = Sunday
  minuteOfDay: number;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    // Throws RangeError for an unknown time zone.
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      weekday: "short",
      hour: "numeric",
      minute: "numeric",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function localParts(instant: Date, timeZone: string): LocalParts {
  const values: Record<string, string> = {};
  for (const p of formatterFor(timeZone).formatToParts(instant)) values[p.type] = p.value;
  const weekday = WEEKDAYS[values.weekday ?? ""];
  if (weekday === undefined) throw new Error(`Unexpected weekday for time zone ${timeZone}`);
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    weekday,
    minuteOfDay: (Number(values.hour) % 24) * 60 + Number(values.minute),
  };
}

/** Offset (local - UTC) in ms at an instant, at minute resolution. */
function offsetAt(instantMs: number, timeZone: string): number {
  const p = localParts(new Date(instantMs), timeZone);
  const localAsUtc = Date.UTC(p.year, p.month - 1, p.day, 0, p.minuteOfDay);
  return localAsUtc - Math.floor(instantMs / MINUTE_MS) * MINUTE_MS;
}

/**
 * UTC instant for a wall-clock time in `timeZone`.
 * Returns undefined when the local time does not exist (spring-forward gap);
 * uses the first occurrence when it is ambiguous (fall-back overlap).
 * Throws for an unknown time zone.
 */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  minuteOfDay: number,
  timeZone: string,
): Date | undefined {
  formatterFor(timeZone); // validate the zone even if no candidate is checked
  const naive = Date.UTC(year, month - 1, day, 0, minuteOfDay);
  if (Number.isNaN(naive)) return undefined;

  const offsets = new Set([offsetAt(naive - DAY_MS, timeZone), offsetAt(naive + DAY_MS, timeZone)]);
  let best: number | undefined;
  for (const offset of offsets) {
    const candidate = naive - offset;
    const p = localParts(new Date(candidate), timeZone);
    if (p.year === year && p.month === month && p.day === day && p.minuteOfDay === minuteOfDay) {
      if (best === undefined || candidate < best) best = candidate;
    }
  }
  return best === undefined ? undefined : new Date(best);
}
