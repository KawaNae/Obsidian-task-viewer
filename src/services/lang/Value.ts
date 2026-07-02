import { addDays, addMonths, addYears } from 'date-fns';

export const DURATION_UNITS = ['min', 'h', 'd', 'w', 'mo', 'y'] as const;
export type DurUnit = typeof DURATION_UNITS[number];

/** 0=sun .. 6=sat (Date.getDay convention) */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export const WEEKDAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

export function weekdayFromName(name: string): Weekday | null {
    const idx = (WEEKDAY_NAMES as readonly string[]).indexOf(name);
    return idx === -1 ? null : idx as Weekday;
}

/**
 * Runtime value model of the expression language.
 * Dates/times are carried as the same string shapes the task model uses
 * (YYYY-MM-DD / HH:mm) so values flow into Task fields without conversion.
 */
export type Value =
    | { type: 'date'; value: string }
    | { type: 'datetime'; date: string; time: string }
    | { type: 'time'; value: string }
    | { type: 'duration'; amount: number; unit: DurUnit }
    | { type: 'string'; value: string }
    | { type: 'number'; value: number }
    | { type: 'bool'; value: boolean }
    | { type: 'weekday'; value: Weekday }
    | { type: 'link'; target: string };

export type LangType = Value['type'];

// ---------------------------------------------------------------------------
// Date string helpers (local time, matching DateUtils conventions)
// ---------------------------------------------------------------------------

export function parseDateStr(s: string): Date {
    const [y, m, d] = s.split('-').map(n => parseInt(n, 10));
    return new Date(y, m - 1, d);
}

export function formatDateStr(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function pad2(n: number): string {
    return String(n).padStart(2, '0');
}

// ---------------------------------------------------------------------------
// Duration arithmetic
// ---------------------------------------------------------------------------

/** Minutes per unit for the fixed-length units. mo/y are calendar-dependent. */
const FIXED_UNIT_MINUTES: Partial<Record<DurUnit, number>> = {
    min: 1,
    h: 60,
    d: 1440,
    w: 10080,
};

export function durationToMinutes(dur: { amount: number; unit: DurUnit }): number | null {
    const f = FIXED_UNIT_MINUTES[dur.unit];
    return f === undefined ? null : dur.amount * f;
}

/**
 * Add a signed duration to a date or datetime value.
 * - min/h on a plain date promotes it to a datetime anchored at 00:00.
 * - mo/y use date-fns addMonths/addYears (month-end clamping included).
 */
export function addDuration(
    base: Value & { type: 'date' | 'datetime' },
    dur: { amount: number; unit: DurUnit },
    sign: 1 | -1 = 1
): Value & { type: 'date' | 'datetime' } {
    const amount = dur.amount * sign;
    const baseDate = base.type === 'date' ? base.value : base.date;
    const baseTime = base.type === 'datetime' ? base.time : undefined;

    if (dur.unit === 'min' || dur.unit === 'h') {
        const [hh, mm] = (baseTime ?? '00:00').split(':').map(n => parseInt(n, 10));
        const totalMin = hh * 60 + mm + amount * (dur.unit === 'h' ? 60 : 1);
        const dayShift = Math.floor(totalMin / 1440);
        const minOfDay = ((totalMin % 1440) + 1440) % 1440;
        const newDate = formatDateStr(addDays(parseDateStr(baseDate), dayShift));
        return { type: 'datetime', date: newDate, time: `${pad2(Math.floor(minOfDay / 60))}:${pad2(minOfDay % 60)}` };
    }

    let d = parseDateStr(baseDate);
    if (dur.unit === 'd') d = addDays(d, amount);
    else if (dur.unit === 'w') d = addDays(d, amount * 7);
    else if (dur.unit === 'mo') d = addMonths(d, amount);
    else d = addYears(d, amount);

    const newDate = formatDateStr(d);
    return baseTime !== undefined
        ? { type: 'datetime', date: newDate, time: baseTime }
        : { type: 'date', value: newDate };
}

// ---------------------------------------------------------------------------
// Comparison / display
// ---------------------------------------------------------------------------

/** Sortable key for date/datetime values (plain dates sort as 00:00). */
export function datishKey(v: Value & { type: 'date' | 'datetime' }): string {
    return v.type === 'date' ? `${v.value}T00:00` : `${v.date}T${v.time}`;
}

export function isDatishValue(v: Value): v is Value & { type: 'date' | 'datetime' } {
    return v.type === 'date' || v.type === 'datetime';
}

/**
 * Compare two values of compatible types. Returns negative/zero/positive,
 * or null when the pair is not comparable (e.g. durations in mo/y vs min).
 */
export function compareValues(a: Value, b: Value): number | null {
    if (isDatishValue(a) && isDatishValue(b)) {
        return datishKey(a).localeCompare(datishKey(b));
    }
    if (a.type !== b.type) return null;
    switch (a.type) {
        case 'string': return a.value.localeCompare((b as typeof a).value);
        case 'number': return a.value - (b as typeof a).value;
        case 'bool': return Number(a.value) - Number((b as typeof a).value);
        case 'time': return a.value.localeCompare((b as typeof a).value);
        case 'weekday': return a.value - (b as typeof a).value;
        case 'link': return a.target === (b as typeof a).target ? 0 : null;
        case 'duration': {
            const bd = b as typeof a;
            if (a.unit === bd.unit) return a.amount - bd.amount;
            const am = durationToMinutes(a);
            const bm = durationToMinutes(bd);
            return am !== null && bm !== null ? am - bm : null;
        }
        default: return null;
    }
}

/** Canonical literal form, used by the serializer for round-tripping. */
export function valueToLiteral(v: Value): string {
    switch (v.type) {
        case 'date': return v.value;
        case 'datetime': return `${v.date}T${v.time}`;
        case 'time': return v.value;
        case 'duration': return `${v.amount}${v.unit}`;
        case 'string': return `"${v.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
        case 'number': return String(v.value);
        case 'bool': return v.value ? 'true' : 'false';
        case 'weekday': return WEEKDAY_NAMES[v.value];
        case 'link': return `[[${v.target}]]`;
    }
}

/** Plain-text rendering used when a value is written into task fields. */
export function valueToDisplay(v: Value): string {
    switch (v.type) {
        case 'string': return v.value;
        case 'link': return `[[${v.target}]]`;
        default: return valueToLiteral(v);
    }
}
