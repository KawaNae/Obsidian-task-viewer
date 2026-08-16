import { addDays, addMonths, addYears } from 'date-fns';

/**
 * Decimal places a number keeps.
 *
 * One grid for the whole language: what division rounds to, what a literal
 * may write, and what every other operation lands on. Numbers here are
 * decimal — `0.1 + 0.2` is `0.3` — because a cell's value is printed and read
 * back each generation, and a float's error would grow with every one.
 */
export const DECIMAL_PLACES = 10;

/** The grid itself. */
export const DECIMAL_SCALE = 10 ** DECIMAL_PLACES;

/**
 * Largest fractional value the carrier holds exactly.
 *
 * The grid maps one-to-one onto doubles only while a double's ulp stays
 * under the grid spacing: ulp(v) < 1e-10 holds for |v| < 2^19. One binade
 * higher the ulp is 1.16e-10 and neighbouring grid points start collapsing
 * into the same double — a value would then drift on the print/read round
 * trip, which is the exact failure the grid exists to prevent. Whole numbers
 * are exact up to 2^53 and do not pay this cost. Past either end the
 * evaluation fails rather than writing a number that is not the one that
 * was computed.
 */
export const MAX_EXACT_FRACTION = 2 ** 19;

export const DURATION_UNITS = ['min', 'h', 'd', 'w', 'mo', 'y'] as const;
export type DurUnit = typeof DURATION_UNITS[number];

/**
 * 0=sun .. 6=sat (Date.getDay convention).
 *
 * Weekdays are not a value type of the expression language — there they are
 * plain strings, so `start.weekday() == "tue"` compares equal. This type
 * belongs to the schedule syntax (`every mon,fri`), which reads the bare
 * names straight from tokens.
 */
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
    | { type: 'link'; target: string }
    /** A list. Immutable: every operation returns a new one. */
    | { type: 'array'; items: Value[] }
    /**
     * A record. Entries rather than an object so the order it was written in
     * survives — printing it back in a different order would read as a
     * different expression.
     */
    | { type: 'record'; entries: { key: string; value: Value }[] }
    | { type: 'none' };

export type LangType = Value['type'];

// ---------------------------------------------------------------------------
// Date string helpers (local time, matching DateUtils conventions)
// ---------------------------------------------------------------------------

/**
 * A date built from a year this language computed.
 *
 * `new Date(y, ...)` maps a two-digit year onto 1900 + y, and the years here
 * are four digits: `0026` is the year 26 and not 1926. Every construction from
 * a year that arithmetic could have produced goes through this, so the shift
 * cannot come back in one of them — it is silent where it happens and only
 * visible much later, on a line that says a different century than the one
 * that was written.
 */
export function dateAt(year: number, monthIndex: number, day: number): Date {
    const date = new Date(year, monthIndex, day);
    if (year >= 0 && year <= 99) date.setFullYear(year);
    return date;
}

export function parseDateStr(s: string): Date {
    const [y, m, d] = s.split('-').map(n => parseInt(n, 10));
    return dateAt(y, m - 1, d);
}

export function formatDateStr(d: Date): string {
    // Padded like the month and the day, and for the same reason: the notation
    // reads four digits, so a year written with fewer is a date the next scan
    // does not see. Every ordinary year is already four, so this shows up only
    // where arithmetic has walked back past the year 1000.
    const y = String(d.getFullYear()).padStart(4, '0');
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/**
 * The years a date can be written in and read back out of.
 *
 * Four digits, because that is what the lexer's date token is and what the
 * `@` notation on a task line accepts. Outside them the shape is still
 * printable and no longer readable: a fire writing `@12025-08-17` produces a
 * line whose date is not a date any more — the text lands in the task's title
 * and the task loses the day it was on. `NaN-NaN-NaN` is the same failure with
 * a louder spelling.
 */
const WRITABLE_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Whether a date value can still be written down and read back.
 *
 * Two readers have to agree with the printer, so both are asked. The notation
 * on a task line takes four digits and nothing else, which is what refuses a
 * year that overflowed into five or fell below zero. And what this language
 * itself reads out of those four digits has to be the day that was written,
 * which is a different question: a shape can be perfectly well formed and
 * still be read as another date.
 *
 * Written as the property rather than as a shape, so that a change to either
 * reader shows up here instead of quietly leaving the rule behind.
 */
export function isWritableDatish(v: Value & { type: 'date' | 'datetime' }): boolean {
    const printed = v.type === 'date' ? v.value : v.date;
    if (!WRITABLE_DATE_RE.test(printed)) return false;
    const read = parseDateStr(printed);
    return Number.isFinite(read.getTime()) && formatDateStr(read) === printed;
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

/** The value of a field, last write winning, or undefined. */
export function recordField(v: Value & { type: 'record' }, key: string): Value | undefined {
    for (let i = v.entries.length - 1; i >= 0; i--) {
        if (v.entries[i].key === key) return v.entries[i].value;
    }
    return undefined;
}

export function isDatishValue(v: Value): v is Value & { type: 'date' | 'datetime' } {
    return v.type === 'date' || v.type === 'datetime';
}

/**
 * Compare two values of compatible types. Returns negative/zero/positive,
 * or null when the pair is not comparable (e.g. durations in mo/y vs min).
 */
export function compareValues(a: Value, b: Value): number | null {
    if (a.type === 'none' && b.type === 'none') return 0;
    if (a.type === 'none' || b.type === 'none') return null;
    if (isDatishValue(a) && isDatishValue(b)) {
        return datishKey(a).localeCompare(datishKey(b));
    }
    if (a.type !== b.type) return null;
    switch (a.type) {
        case 'string': return a.value.localeCompare((b as typeof a).value);
        case 'number': return a.value - (b as typeof a).value;
        case 'bool': return Number(a.value) - Number((b as typeof a).value);
        case 'time': return a.value.localeCompare((b as typeof a).value);
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

/**
 * A field name as it is written.
 *
 * Quoted unless it is a plain identifier: printed bare, a name with a space
 * in it reads as a name followed by a stray word. One implementation, used by
 * both the value form and the expression printer — the rule cannot be right
 * in one place and wrong in the other.
 */
export function fieldKeyLiteral(key: string): string {
    return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : JSON.stringify(key);
}

/**
 * A number, written so it can be read back.
 *
 * Fixed point, never exponential: JS writes 1e-7 for a small value and the
 * lexer has no way to read that, so the round trip would break on exactly the
 * values the grid exists to support. Trailing zeros go, since they say
 * nothing.
 */
export function numberToLiteral(value: number): string {
    if (Number.isInteger(value)) return String(value);
    return value.toFixed(DECIMAL_PLACES).replace(/0+$/, '').replace(/\.$/, '');
}

/**
 * A string as source, escaped for everything the lexer reads back.
 *
 * The printer's escapes have to cover the lexer's, and a newline is where that
 * stops being obvious: a value written in the source cannot hold one, so for a
 * long time nothing could reach this with one. A computed string can — a cell
 * carries what a block wrote, and `join("\n")` is the idiom of the feature —
 * and printing that raw would put a second line where a command was, leaving a
 * command the next scan cannot read.
 */
function escapeString(value: string): string {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/\n/g, '\\n')
        .replace(/\t/g, '\\t');
}

/** Canonical literal form, used by the serializer for round-tripping. */
export function valueToLiteral(v: Value): string {
    switch (v.type) {
        case 'date': return v.value;
        case 'datetime': return `${v.date}T${v.time}`;
        case 'time': return v.value;
        case 'duration': return `${v.amount}${v.unit}`;
        case 'string': return `"${escapeString(v.value)}"`;
        case 'number': return numberToLiteral(v.value);
        case 'bool': return v.value ? 'true' : 'false';
        case 'link': return `[[${v.target}]]`;
        case 'array': return `[${v.items.map(valueToLiteral).join(', ')}]`;
        case 'record': return `{${v.entries.map(e => `${fieldKeyLiteral(e.key)}: ${valueToLiteral(e.value)}`).join(', ')}}`;
        case 'none': return 'none';
    }
}

/** Plain-text rendering used when a value is written into task fields. */
export function valueToDisplay(v: Value): string {
    switch (v.type) {
        case 'string': return v.value;
        case 'link': return `[[${v.target}]]`;
        // A list is lines — the same rule interpolation uses for a multi-line
        // value, so a list and its newline join land on the same text.
        case 'array': return v.items.map(valueToDisplay).join('\n');
        // A record has no reading as text; showing its literal form at least
        // says what it is rather than putting "[object Object]" in a note.
        case 'record': return valueToLiteral(v);
        case 'none': return '';
        default: return valueToLiteral(v);
    }
}
