import {
    DEFAULT_SETTINGS, normalizeScopeKeys,
    type ScopeKeys, type StatusDefinition, type TaskViewerSettings,
} from '../types';
import { ScopeKeyInput } from '../services/parsing/utils/PropertyKeyInput';
import { StatusCharInput } from '../services/parsing/utils/StatusCharInput';
import { HeadingInput } from '../services/parsing/utils/HeadingInput';
import { FloatInput, FloatValue, IntInput, IntValue, type NumberRange } from '../utils/values/NumberValues';
import { TrimmedText } from '../utils/values/TextValues';
import { readFail, readOk, type FieldCodec, type Issue, type Read } from '../utils/values/Read';

/**
 * The settings' one table of values (I#11, 入力の所見4): for each key, how
 * a stored value is read (`check`), and, for a key a text field sets, how
 * the field's text is read (`codec`). The load (`readSettings`) and the
 * settings' fields read the same table, so what the load keeps is what a
 * field takes; and a menu that sets a key (the timer's Custom...) reads its
 * range here too (論点6).
 *
 * The values a key falls back on are `DEFAULT_SETTINGS`'s.
 */

/** A setting held as one value. */
export interface SettingLeaf<T> {
    /** Read a stored value (from `data.json`): the value, or why it is not one. */
    readonly check: (stored: unknown) => Read<T>;
    /** How a text field that sets it reads its text. */
    readonly codec?: FieldCodec<T>;
}

/** A whole number setting: its range, for a field or a menu to say. */
export interface IntSetting extends SettingLeaf<number> {
    readonly range: NumberRange;
    readonly codec: FieldCodec<number>;
}

/** A setting that is an object of settings, each read on its own and falling back on its own. */
export interface SettingGroup<T> {
    readonly fields: SchemaOf<T>;
}

export type SettingSpec<T> = SettingLeaf<T> | SettingGroup<T>;

export type SchemaOf<T> = { readonly [K in keyof T]-?: SettingSpec<T[K]> };

// ── Kinds of value ──────────────────────────────────────────

function int(range: NumberRange): IntSetting {
    return { check: (v) => IntValue.check(v, range), codec: IntInput.codec(range), range };
}

function float(range: NumberRange): SettingLeaf<number> & { codec: FieldCodec<number> } {
    return { check: (v) => FloatValue.check(v, range), codec: FloatInput.codec(range) };
}

const bool: SettingLeaf<boolean> = {
    check: (v) => (typeof v === 'boolean' ? readOk(v) : readFail({ code: 'shape', kind: 'bool' })),
};

/** One of a fixed set of values, as stored (a word, or a number such as the week's first day). */
function oneOf<const V extends string | number>(allowed: readonly V[]): SettingLeaf<V> {
    return {
        check: (v) => (allowed.includes(v as V)
            ? readOk(v as V)
            : readFail({ code: 'oneOf', allowed: allowed.map(String) })),
    };
}

/** Text, stored and typed read alike by `codec`. */
function text(codec: FieldCodec<string>): SettingLeaf<string> & { codec: FieldCodec<string> } {
    return {
        check: (v) => (typeof v === 'string' ? codec.read(v) : readFail({ code: 'shape', kind: 'text' })),
        codec,
    };
}

/** A periodic note's name format: the space around it taken off, and the default format for none. */
function format(fallback: string): FieldCodec<string> {
    return { read: (t) => readOk(t.trim() || fallback), show: (f) => f };
}

const POSITIONS = ['left', 'right', 'tab', 'window'] as const;
const FIELD_MAPPINGS = ['startDate', 'endDate', 'due', 'ignore'] as const;

/**
 * The scope keys, read as one set: a key missing or empty takes its
 * default (`normalizeScopeKeys`), and each must be one the settings' field
 * takes (`ScopeKeyInput`: a key a property line reads, not reserved, none
 * of the others'). A set with one that is not falls back whole, as a key
 * changed alone could clash with another.
 */
const scopeKeys: SettingLeaf<ScopeKeys> = {
    check(v) {
        if (v === null || typeof v !== 'object') return readFail({ code: 'shape', kind: 'text' });
        const keys = normalizeScopeKeys(v);
        const names = Object.keys(keys) as (keyof ScopeKeys)[];
        for (const name of names) {
            const read = ScopeKeyInput.read(keys[name], names.filter(n => n !== name).map(n => keys[n]));
            if (!read.ok) return read;
        }
        return readOk(keys);
    },
};

/**
 * The statuses, read as one list: each a character a checkbox holds (or
 * none yet: a status just added), none of another's, a label, and whether
 * it is complete. A list with one that is not falls back whole.
 */
const statusDefinitions: SettingLeaf<StatusDefinition[]> = {
    check(v) {
        if (!Array.isArray(v)) return readFail({ code: 'shape', kind: 'text' });
        const defs: StatusDefinition[] = [];
        for (const item of v as unknown[]) {
            const def = item as Partial<Record<keyof StatusDefinition, unknown>> | null;
            if (def === null || typeof def !== 'object') return readFail({ code: 'shape', kind: 'statusChar' });
            if (typeof def.label !== 'string') return readFail({ code: 'shape', kind: 'text' });
            if (typeof def.isComplete !== 'boolean') return readFail({ code: 'shape', kind: 'bool' });
            if (typeof def.char !== 'string') return readFail({ code: 'shape', kind: 'statusChar' });
            if (def.char !== '') {
                const char = StatusCharInput.read(def.char, defs.map(d => d.char));
                if (!char.ok) return char;
            }
            defs.push({ char: def.char, label: def.label, isComplete: def.isComplete });
        }
        return readOk(defs);
    },
};

// ── The table ───────────────────────────────────────────────

export const SETTINGS_SCHEMA = {
    startHour: int({ min: 0, max: 23 }),
    applyGlobalStyles: bool,
    enableStatusMenu: bool,
    statusDefinitions,
    scopeKeys,
    zoomLevel: float({ min: 0.25, max: 10 }),
    taskHeading: text(HeadingInput),
    taskHeadingLevel: int({ min: 1, max: 6 }),
    sectionSide: oneOf(['head', 'end']),
    // 論点6: the work and the break take any length of a minute or more.
    pomodoroWorkMinutes: int({ min: 1 }),
    pomodoroBreakMinutes: int({ min: 1 }),
    countdownMinutes: int({ min: 1 }),
    pastDaysToShow: int({ min: 0 }),
    startFromOldestOverdue: bool,
    doubleTapAction: oneOf(['detail', 'open', 'menu']),
    longPressThreshold: int({ min: 100, max: 2000 }),
    reuseExistingTab: bool,
    editorMenuForTasks: bool,
    editorMenuForCheckboxes: bool,
    weekStartDay: oneOf([0, 1]),
    calendarShowWeekNumbers: bool,
    weeklyNoteFormat: text(format(DEFAULT_SETTINGS.weeklyNoteFormat)),
    weeklyNoteFolder: text(TrimmedText),
    weeklyNoteTemplate: text(TrimmedText),
    monthlyNoteFormat: text(format(DEFAULT_SETTINGS.monthlyNoteFormat)),
    monthlyNoteFolder: text(TrimmedText),
    monthlyNoteTemplate: text(TrimmedText),
    yearlyNoteFormat: text(format(DEFAULT_SETTINGS.yearlyNoteFormat)),
    yearlyNoteFolder: text(TrimmedText),
    yearlyNoteTemplate: text(TrimmedText),
    intervalTemplateFolder: text(TrimmedText),
    viewTemplateFolder: text(TrimmedText),
    exportFolder: text(TrimmedText),
    pinnedListPageSize: int({ min: 1 }),
    defaultViewPositions: {
        fields: {
            timeline: oneOf(POSITIONS),
            schedule: oneOf(POSITIONS),
            calendar: oneOf(POSITIONS),
            miniCalendar: oneOf(POSITIONS),
            timer: oneOf(POSITIONS),
            kanban: oneOf(POSITIONS),
        },
    },
    enableCardFileLink: bool,
    childCollapseThreshold: int({ min: 1, max: 5 }),
    suggestColor: bool,
    suggestLinestyle: bool,
    hideViewHeader: bool,
    mobileTopOffset: int({ min: 0 }),
    fixMobileGradientWidth: bool,
    showAllDay: bool,
    showTimeline: bool,
    showWeekRow: bool,
    enableTasksPlugin: bool,
    enableDayPlanner: bool,
    tasksPluginMapping: {
        fields: {
            start: oneOf(FIELD_MAPPINGS),
            scheduled: oneOf(FIELD_MAPPINGS),
            due: oneOf(FIELD_MAPPINGS),
        },
    },
    astronomy: {
        fields: {
            display: {
                fields: { sunTimes: bool, moonPhase: bool, sunTimesInFront: bool },
            },
            location: {
                fields: {
                    latitude: float({ min: -90, max: 90 }),
                    longitude: float({ min: -180, max: 180 }),
                },
            },
        },
    },
    logRetentionDays: int({ min: 1 }),
    // 0 is no limit.
    logMaxStorageMB: int({ min: 0 }),
    verboseNotice: bool,
} satisfies SchemaOf<TaskViewerSettings>;

// ── The load ────────────────────────────────────────────────

/** A stored value the load did not keep: where it was, and why. */
export interface SettingFix {
    /** The key's path, as `defaultViewPositions.kanban`. */
    readonly path: string;
    readonly issue: Issue;
}

/**
 * Read the stored settings (`data.json`'s object) by the table: each key
 * read by its `check`, a group key by key. A key that is missing takes its
 * default; one whose value is not read takes its default too, and is told
 * in `fixes`. What the table does not hold (a key of an older version) is
 * left out, and goes from the file on the next save.
 */
export function readSettings(stored: unknown): { settings: TaskViewerSettings; fixes: SettingFix[] } {
    const fixes: SettingFix[] = [];
    const settings = readGroup(SETTINGS_SCHEMA as SchemaOf<TaskViewerSettings>, stored, DEFAULT_SETTINGS, '', fixes);
    return { settings, fixes };
}

function readGroup<T>(fields: SchemaOf<T>, stored: unknown, fallback: T, at: string, fixes: SettingFix[]): T {
    const source = stored !== null && typeof stored === 'object' ? stored as Record<string, unknown> : {};
    const out = {} as T;
    for (const key of Object.keys(fields) as (keyof T & string)[]) {
        out[key] = readSpec(fields[key], source[key], fallback[key], at ? `${at}.${key}` : key, fixes);
    }
    return out;
}

function readSpec<T>(spec: SettingSpec<T>, stored: unknown, fallback: T, path: string, fixes: SettingFix[]): T {
    if ('fields' in spec) return readGroup(spec.fields, stored, fallback, path, fixes);
    if (stored === undefined) return copyOf(fallback);
    const read = spec.check(stored);
    if (read.ok) return read.value;
    fixes.push({ path, issue: read.issue });
    return copyOf(fallback);
}

/** A default given to the settings is their own: an edit of a list or an object does not reach `DEFAULT_SETTINGS`. */
function copyOf<T>(value: T): T {
    return value !== null && typeof value === 'object' ? structuredClone(value) : value;
}
