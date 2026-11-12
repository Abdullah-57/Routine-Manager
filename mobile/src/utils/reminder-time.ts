/** Local calendar date YYYY-MM-DD in a timezone. */
export function dateKeyInTimezone(isoOrDate: string | Date, timezone: string): string {
  const date = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  }
}

export function formatReminderTime(iso: string, timezone: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: timezone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  }
}

/** Clock time only in the given IANA timezone — never device-local by accident. */
export function formatTimeOnly(
  iso: string,
  timezone: string,
  use24HourClock = true,
) {
  const hourCycle = use24HourClock ? "h23" : "h12";
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle,
    }).format(new Date(iso));
  } catch {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle,
    }).format(new Date(iso));
  }
}

/** Inclusive local-day bounds as ISO strings with offset for API queries. */
export function dayRangeISO(dateKey: string, timezone: string): {
  fromISO: string;
  toISO: string;
} {
  // Build noon UTC on that calendar date, then find local midnight via iterative format.
  // Simpler approach: use a formatter offset from a known instant.
  const probe = new Date(`${dateKey}T12:00:00.000Z`);
  const offsetMinutes = getTimeZoneOffsetMinutes(timezone, probe);
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  const offset = `${sign}${hh}:${mm}`;

  return {
    fromISO: `${dateKey}T00:00:00${offset}`,
    toISO: `${dateKey}T23:59:59${offset}`,
  };
}

export function monthRangeISO(
  year: number,
  month1Based: number,
  timezone: string,
): { fromISO: string; toISO: string } {
  const startKey = `${year}-${String(month1Based).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, month1Based, 0)).getUTCDate();
  const endKey = `${year}-${String(month1Based).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const start = dayRangeISO(startKey, timezone);
  const end = dayRangeISO(endKey, timezone);
  return { fromISO: start.fromISO, toISO: end.toISO };
}

function getTimeZoneOffsetMinutes(timezone: string, date: Date): number {
  try {
    const dtf = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "longOffset",
    });
    const raw =
      dtf.formatToParts(date).find((part) => part.type === "timeZoneName")
        ?.value ?? "GMT";
    if (raw === "GMT" || raw === "UTC") return 0;
    const match = raw.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/i);
    if (!match) return 0;
    const sign = match[1] === "-" ? -1 : 1;
    const hours = Number(match[2]);
    const minutes = Number(match[3] ?? "0");
    return sign * (hours * 60 + minutes);
  } catch {
    return 0;
  }
}

export function todayDateKey(timezone: string): string {
  return dateKeyInTimezone(new Date(), timezone);
}

/** Ascending by start time (earliest first). Stable title tie-break. */
export function compareRemindersByStartAscending(
  a: { title: string; startAt: string },
  b: { title: string; startAt: string },
): number {
  const aMs = new Date(a.startAt).getTime();
  const bMs = new Date(b.startAt).getTime();
  const aValid = Number.isFinite(aMs);
  const bValid = Number.isFinite(bMs);
  if (aValid && bValid && aMs !== bMs) return aMs - bMs;
  if (aValid && !bValid) return -1;
  if (!aValid && bValid) return 1;
  return a.title.localeCompare(b.title);
}

function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const hh = String(Math.floor(abs / 60)).padStart(2, "0");
  const mm = String(abs % 60).padStart(2, "0");
  return `${sign}${hh}:${mm}`;
}

/** Editable local value: YYYY-MM-DDTHH:mm in the given timezone. */
export function toLocalDateTimeInput(iso: string, timezone: string): string {
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

/**
 * Convert YYYY-MM-DDTHH:mm (or with seconds) in a timezone to ISO with offset.
 * Returns null if the input is invalid.
 */
export function fromLocalDateTimeInput(
  value: string,
  timezone: string,
): string | null {
  const trimmed = value.trim();
  const match = trimmed.match(
    /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (!match) return null;

  const dateKey = match[1];
  const hour = match[2];
  const minute = match[3];
  const second = match[4] ?? "00";
  const probe = new Date(`${dateKey}T${hour}:${minute}:${second}.000Z`);
  if (Number.isNaN(probe.getTime())) return null;

  const offset = formatOffset(getTimeZoneOffsetMinutes(timezone, probe));
  const iso = `${dateKey}T${hour}:${minute}:${second}${offset}`;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return iso;
}
