import { useMemo } from "react";
import { Panel, Field, inputClass, selectClass } from "./Panel";

const IANA_TIMEZONES = [
  "Africa/Lagos",
  "Africa/Accra",
  "Africa/Abidjan",
  "Africa/Nairobi",
  "Africa/Johannesburg",
  "Africa/Cairo",
  "Africa/Casablanca",
  "Africa/Tunis",
  "Africa/Kigali",
  "Africa/Addis_Ababa",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Amsterdam",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Sao_Paulo",
  "Asia/Dubai",
  "Asia/Riyadh",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
  "UTC",
];

// Cities to show in the live multi-timezone box
const DISPLAY_ZONES: { label: string; tz: string }[] = [
  { label: "Lagos / Cotonou / Lomé", tz: "Africa/Lagos" },
  { label: "Accra / Abidjan", tz: "Africa/Accra" },
  { label: "Douala / Yaoundé", tz: "Africa/Douala" },
  { label: "Nairobi", tz: "Africa/Nairobi" },
];

interface Props {
  scheduledDate: string;      // "YYYY-MM-DD"
  scheduledTime: string;      // "HH:MM"
  timezone: string;
  durationMinutes: string;
  registrationClosesAt: string; // "YYYY-MM-DDTHH:MM"
  capacity: string;
  onScheduledDate: (v: string) => void;
  onScheduledTime: (v: string) => void;
  onTimezone: (v: string) => void;
  onDurationMinutes: (v: string) => void;
  onRegistrationClosesAt: (v: string) => void;
  onCapacity: (v: string) => void;
  errors: Record<string, string>;
}

function toLocalDatetime(date: string, time: string, tz: string): Date | null {
  if (!date || !time) return null;
  try {
    // Build an ISO string and parse it — we treat the user's entered date+time as being in
    // their chosen timezone. Intl.DateTimeFormat tells us the UTC offset.
    const naive = `${date}T${time}:00`;
    // Use the Intl trick to find offset
    const testDate = new Date(naive + "Z");
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(testDate);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
    const tzYear = get("year");
    const tzMonth = get("month");
    const tzDay = get("day");
    const tzHour = get("hour");
    const tzMin = get("minute");
    const tzSec = get("second");

    // Offset = naive - tz-interpreted UTC time
    const utcViaFormat = new Date(`${tzYear}-${tzMonth}-${tzDay}T${tzHour}:${tzMin}:${tzSec}Z`);
    const diff = testDate.getTime() - utcViaFormat.getTime();

    // Real UTC for the user's local time
    const naiveMs = new Date(naive).getTime();
    return new Date(naiveMs + diff);
  } catch {
    return null;
  }
}

function formatInTz(date: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  } catch {
    return "—";
  }
}

export function SchedulePanel({
  scheduledDate,
  scheduledTime,
  timezone,
  durationMinutes,
  registrationClosesAt,
  capacity,
  onScheduledDate,
  onScheduledTime,
  onTimezone,
  onDurationMinutes,
  onRegistrationClosesAt,
  onCapacity,
  errors,
}: Props) {
  const utcDate = useMemo(
    () => toLocalDatetime(scheduledDate, scheduledTime, timezone),
    [scheduledDate, scheduledTime, timezone],
  );

  return (
    <Panel title="Schedule" description="All times stored in UTC; displayed in selected timezone." error={!!(errors.scheduledDate || errors.scheduledTime)}>
      <div className="space-y-4">
        {/* Date + Time row */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start Date" required error={errors.scheduledDate}>
            <input
              type="date"
              className={inputClass}
              value={scheduledDate}
              onChange={(e) => onScheduledDate(e.target.value)}
            />
          </Field>
          <Field label="Start Time" required error={errors.scheduledTime}>
            <input
              type="time"
              className={inputClass}
              value={scheduledTime}
              onChange={(e) => onScheduledTime(e.target.value)}
            />
          </Field>
        </div>

        {/* Timezone */}
        <Field label="Timezone">
          <select
            className={selectClass}
            value={timezone}
            onChange={(e) => onTimezone(e.target.value)}
          >
            {IANA_TIMEZONES.map((tz) => (
              <option key={tz} value={tz}>{tz}</option>
            ))}
          </select>
        </Field>

        {/* Duration */}
        <Field label="Duration (minutes)" required error={errors.durationMinutes} hint="Default 60 minutes.">
          <input
            type="number"
            className={inputClass}
            min={1}
            value={durationMinutes}
            onChange={(e) => onDurationMinutes(e.target.value)}
            placeholder="60"
          />
        </Field>

        {/* Live multi-timezone display */}
        {utcDate && (
          <div className="rounded-lg border border-slate-800 bg-slate-950/60 p-3">
            <p className="mb-2 text-xs font-medium text-slate-400">Equivalent times</p>
            <div className="space-y-1">
              {DISPLAY_ZONES.map(({ label, tz }) => (
                <div key={tz} className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">{label}</span>
                  <span className="tabular-nums text-slate-200">{formatInTz(utcDate, tz)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Registration closes */}
        <Field
          label="Registration closes"
          hint="Optional. Must be before the session start time."
          error={errors.registrationClosesAt}
        >
          <input
            type="datetime-local"
            className={inputClass}
            value={registrationClosesAt}
            onChange={(e) => onRegistrationClosesAt(e.target.value)}
          />
        </Field>

        {/* Capacity */}
        <Field label="Capacity" hint="Optional. Leave blank for unlimited.">
          <input
            type="number"
            className={inputClass}
            min={1}
            value={capacity}
            onChange={(e) => onCapacity(e.target.value)}
            placeholder="Unlimited"
          />
        </Field>
      </div>
    </Panel>
  );
}
