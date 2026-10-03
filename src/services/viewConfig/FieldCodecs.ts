/**
 * Field codec factories.
 *
 * `F.*` produces ConfigField<T> for canonical-config fields (persisted in
 * template + workspace state + URI). `T.*` produces TransientField<T> for
 * workspace-only fields.
 *
 * URI encoding strategy:
 *   - Primitive (boolean/number/string): plain string, no base64.
 *   - Complex (objects, arrays): base64-encoded JSON (via unicodeBtoa).
 *
 * Per-field codecs centralize the per-type parse/serialize asymmetries that
 * used to be replicated across 5 boundary call sites in the old codebase.
 * The scalar fields read their text with the input codecs of
 * `utils/values` (normalization, shape, validity) and add only where the
 * value is stored and how it is spelled in a URI.
 */

import { valueOf } from '../../utils/values/Read';
import { DateInput } from '../../utils/values/DateValues';
import { IntInput, IntValue, FloatInput, FloatValue, type NumberRange } from '../../utils/values/NumberValues';
import { BoolInput, ChoiceInput } from '../../utils/values/ChoiceValues';
import type { ConfigField, TransientField, ReportIssue } from './ViewConfigSchema';
import type { FilterState } from '../filter/FilterTypes';
import { hasConditions } from '../filter/FilterTypes';
import { FilterSerializer, filterIssueText, type FilterRead } from '../filter/FilterSerializer';
import { SortSerializer, sortIssueText } from '../sort/SortSerializer';
import { unicodeBtoa, unicodeAtob } from '../../utils/base64';
import type { PinnedListDefinition, AstronomyDisplay } from '../../types';
import { newListId } from './ListIds';

interface FieldOptions {
    readonly legacyKeys?: readonly string[];
}

const ASTRONOMY_KEYS = ['sunTimes', 'moonPhase', 'sunTimesInFront'] as const satisfies readonly (keyof AstronomyDisplay)[];

// ── helpers ──

function tryDecodeBase64Json(raw: string): unknown {
    try {
        return JSON.parse(unicodeAtob(raw));
    } catch {
        return undefined;
    }
}

function encodeBase64Json(value: unknown): string {
    return unicodeBtoa(JSON.stringify(value));
}

// ── ConfigField factories ──

export const F = {
    boolean(key: string, opts: FieldOptions = {}): ConfigField<boolean> {
        return {
            key,
            legacyKeys: opts.legacyKeys,
            parse(raw) {
                if (typeof raw === 'boolean') return raw;
                if (typeof raw === 'string') return valueOf(BoolInput.read(raw));
                return undefined;
            },
            serialize(value) {
                return typeof value === 'boolean' ? value : undefined;
            },
            toUriParam(value) {
                return value ? 'true' : 'false';
            },
            fromUriParam(raw) {
                return valueOf(BoolInput.read(raw));
            },
        };
    },

    optionalString(key: string, opts: FieldOptions = {}): ConfigField<string> {
        return {
            key,
            legacyKeys: opts.legacyKeys,
            parse(raw) {
                if (typeof raw !== 'string') return undefined;
                const trimmed = raw.trim();
                return trimmed ? raw : undefined;
            },
            serialize(value) {
                return typeof value === 'string' && value.trim() ? value : undefined;
            },
            toUriParam(value) {
                return encodeURIComponent(value);
            },
            fromUriParam(raw) {
                // Note: Obsidian's protocol handler already URL-decodes params; this is for
                // the case where we receive a still-encoded value (e.g. round-trip tests).
                try { return decodeURIComponent(raw); } catch { return raw; }
            },
        };
    },

    /**
     * Bounded integer, read by `IntInput` / `IntValue`: a whole decimal
     * number in range, or undefined (the field's default), never coerced or
     * moved to the range's end.
     */
    int(
        key: string,
        opts: FieldOptions & NumberRange = {},
    ): ConfigField<number> {
        const range: NumberRange = { min: opts.min, max: opts.max };
        const parseString = (raw: string) => valueOf(IntInput.read(raw, range));
        return {
            key,
            legacyKeys: opts.legacyKeys,
            parse(raw) {
                if (typeof raw === 'number') return valueOf(IntValue.check(raw, range));
                if (typeof raw === 'string') return parseString(raw);
                return undefined;
            },
            serialize(value) {
                return valueOf(IntValue.check(value, range));
            },
            toUriParam(value) { return String(value); },
            fromUriParam(raw) { return parseString(raw); },
        };
    },

    stringEnum<const S extends string>(
        key: string,
        allowed: readonly S[],
        opts: FieldOptions = {},
    ): ConfigField<S> {
        const choice = ChoiceInput.of(allowed);
        const set = new Set<string>(allowed);
        return {
            key,
            legacyKeys: opts.legacyKeys,
            parse(raw) {
                return typeof raw === 'string' ? valueOf(choice.read(raw)) : undefined;
            },
            serialize(value) {
                return typeof value === 'string' && set.has(value) ? value : undefined;
            },
            toUriParam(value) { return String(value); },
            fromUriParam(raw) { return valueOf(choice.read(raw)); },
        };
    },

    /** Bounded decimal number, read by `FloatInput` / `FloatValue`, as `int` is. */
    float(
        key: string,
        opts: FieldOptions & NumberRange = {},
    ): ConfigField<number> {
        const range: NumberRange = { min: opts.min, max: opts.max };
        const parseString = (raw: string) => valueOf(FloatInput.read(raw, range));
        return {
            key,
            legacyKeys: opts.legacyKeys,
            parse(raw) {
                if (typeof raw === 'number') return valueOf(FloatValue.check(raw, range));
                if (typeof raw === 'string') return parseString(raw);
                return undefined;
            },
            serialize(value) {
                return valueOf(FloatValue.check(value, range));
            },
            toUriParam(value) { return String(value); },
            fromUriParam(raw) { return parseString(raw); },
        };
    },

    /**
     * FilterState. Workspace state and template JSON store the serialized JSON
     * form (FilterSerializer.toJSON). URI form is base64-encoded JSON.
     * Empty filter states (no conditions) are omitted entirely. A condition
     * FilterSerializer cannot read is dropped and reported.
     */
    filter(key: string, opts: FieldOptions = {}): ConfigField<FilterState> {
        return {
            key,
            legacyKeys: opts.legacyKeys,
            parse(raw, report) {
                if (!raw || typeof raw !== 'object') return undefined;
                const state = reportedFilter(FilterSerializer.parse(raw), report);
                return hasConditions(state) ? state : undefined;
            },
            serialize(value) {
                if (!value || !hasConditions(value)) return undefined;
                return FilterSerializer.toJSON(value);
            },
            toUriParam(value) {
                return hasConditions(value) ? FilterSerializer.toURIParam(value) : undefined;
            },
            fromUriParam(raw, report) {
                const state = reportedFilter(FilterSerializer.parseURIParam(raw), report);
                return hasConditions(state) ? state : undefined;
            },
        };
    },

    /**
     * PinnedList[] with nested FilterState. Each list's filterState is
     * serialized via FilterSerializer.toJSON (so the persisted form is plain
     * JSON, not the runtime object).
     */
    pinnedLists(key: string, opts: FieldOptions = {}): ConfigField<PinnedListDefinition[]> {
        return {
            key,
            legacyKeys: opts.legacyKeys,
            parse(raw, report) {
                if (!Array.isArray(raw)) return undefined;
                const result = parsePinnedLists(raw, report);
                return result.length > 0 ? result : undefined;
            },
            serialize(value) {
                if (!Array.isArray(value) || value.length === 0) return undefined;
                return value.map(serializePinnedList);
            },
            toUriParam(value) {
                if (!Array.isArray(value) || value.length === 0) return undefined;
                return encodeBase64Json(value.map(serializePinnedList));
            },
            fromUriParam(raw, report) {
                const decoded = tryDecodeBase64Json(raw);
                if (!Array.isArray(decoded)) return undefined;
                const result = parsePinnedLists(decoded, report);
                return result.length > 0 ? result : undefined;
            },
        };
    },

    grid(key: string, opts: FieldOptions = {}): ConfigField<PinnedListDefinition[][]> {
        return {
            key,
            legacyKeys: opts.legacyKeys,
            parse(raw, report) {
                if (!Array.isArray(raw)) return undefined;
                const grid = parseGrid(raw, report);
                return grid.length > 0 ? grid : undefined;
            },
            serialize(value) {
                if (!Array.isArray(value) || value.length === 0) return undefined;
                return value.map(row => row.map(serializePinnedList));
            },
            toUriParam(value) {
                if (!Array.isArray(value) || value.length === 0) return undefined;
                return encodeBase64Json(value.map(row => row.map(serializePinnedList)));
            },
            fromUriParam(raw, report) {
                const decoded = tryDecodeBase64Json(raw);
                if (!Array.isArray(decoded)) return undefined;
                const grid = parseGrid(decoded, report);
                return grid.length > 0 ? grid : undefined;
            },
        };
    },

    /**
     * Partial<AstronomyDisplay>. Only known overlay keys (see ASTRONOMY_KEYS)
     * are accepted; everything else is dropped. Empty objects are omitted.
     */
    astronomyDisplay(key: string, opts: FieldOptions = {}): ConfigField<Partial<AstronomyDisplay>> {
        const filterAstronomy = (raw: unknown): Partial<AstronomyDisplay> | undefined => {
            if (!raw || typeof raw !== 'object') return undefined;
            const src = raw as Record<string, unknown>;
            const out: Partial<AstronomyDisplay> = {};
            for (const k of ASTRONOMY_KEYS) {
                if (typeof src[k] === 'boolean') out[k] = src[k] as boolean;
            }
            return Object.keys(out).length > 0 ? out : undefined;
        };
        return {
            key,
            legacyKeys: opts.legacyKeys,
            parse(raw) { return filterAstronomy(raw); },
            serialize(value) {
                if (!value || typeof value !== 'object') return undefined;
                const out: Record<string, boolean> = {};
                for (const k of ASTRONOMY_KEYS) {
                    if (typeof value[k] === 'boolean') out[k] = value[k] as boolean;
                }
                return Object.keys(out).length > 0 ? out : undefined;
            },
            toUriParam(value) {
                const serialized = this.serialize(value);
                return serialized ? encodeBase64Json(serialized) : undefined;
            },
            fromUriParam(raw) {
                return filterAstronomy(tryDecodeBase64Json(raw));
            },
        };
    },

    /** A `YYYY-MM-DD` naming a day that exists, read by `DateInput`. */
    dateString(key: string, opts: FieldOptions = {}): ConfigField<string> {
        const read = (raw: unknown) => typeof raw === 'string' ? valueOf(DateInput.read(raw)) : undefined;
        return {
            key,
            legacyKeys: opts.legacyKeys,
            parse: read,
            serialize: read,
            toUriParam: read,
            fromUriParam: read,
        };
    },
};

// ── TransientField factories ──

interface TransientOpts { readonly legacyKeys?: readonly string[] }

export const T = {
    dateString(key: string, opts: TransientOpts = {}): TransientField<string> {
        const f = F.dateString(key, opts);
        return { key: f.key, parse: f.parse, serialize: f.serialize, legacyKeys: opts.legacyKeys };
    },

    /** A whole number, read as `F.int` reads it (a URI's text included). */
    int(key: string, opts: TransientOpts & NumberRange = {}): TransientField<number> {
        const f = F.int(key, opts);
        return { key: f.key, parse: f.parse, serialize: f.serialize, legacyKeys: opts.legacyKeys };
    },

    boolean(key: string, opts: TransientOpts = {}): TransientField<boolean> {
        const f = F.boolean(key, opts);
        return { key: f.key, parse: f.parse, serialize: f.serialize, legacyKeys: opts.legacyKeys };
    },

    /**
     * Which lists are collapsed, by list id. Only `true` entries are kept.
     *
     * An older layout names each list `<legacyPrefix>::<id>` (the
     * view's name, put on to keep views apart that never shared the map);
     * it is read as `<id>`, and a key with another view's name is dropped.
     */
    collapsedKeys(
        key: string,
        legacyPrefix?: string,
        opts: TransientOpts = {},
    ): TransientField<Record<string, boolean>> {
        const prefix = legacyPrefix ? `${legacyPrefix}::` : '';
        return {
            key,
            legacyKeys: opts.legacyKeys,
            parse(raw) {
                if (!raw || typeof raw !== 'object') return undefined;
                const out: Record<string, boolean> = {};
                for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
                    if (v !== true) continue;
                    if (!k.includes('::')) out[k] = true;
                    else if (prefix && k.startsWith(prefix)) out[k.slice(prefix.length)] = true;
                }
                return Object.keys(out).length > 0 ? out : undefined;
            },
            serialize(value) {
                if (!value || typeof value !== 'object') return undefined;
                const out: Record<string, boolean> = {};
                for (const [k, v] of Object.entries(value)) {
                    if (v === true) out[k] = true;
                }
                return Object.keys(out).length > 0 ? out : undefined;
            },
        };
    },

    optionalString(key: string, opts: TransientOpts = {}): TransientField<string> {
        const f = F.optionalString(key, opts);
        return { key: f.key, parse: f.parse, serialize: f.serialize, legacyKeys: opts.legacyKeys };
    },

    stringEnum<const S extends string>(
        key: string,
        allowed: readonly S[],
        opts: TransientOpts = {},
    ): TransientField<S> {
        const f = F.stringEnum(key, allowed, opts);
        return { key: f.key, parse: f.parse, serialize: f.serialize, legacyKeys: opts.legacyKeys };
    },
};

// ── Internal helpers (pinnedLists / grid) ──

function serializePinnedList(pl: PinnedListDefinition): Record<string, unknown> {
    const result: Record<string, unknown> = {
        id: pl.id,
        name: pl.name,
        filterState: FilterSerializer.toJSON(pl.filterState),
        applyViewFilter: pl.applyViewFilter,
    };
    if (pl.sortState) result.sortState = SortSerializer.toJSON(pl.sortState);
    if (pl.topRight && pl.topRight.fields.length > 0) {
        const tr: Record<string, unknown> = { fields: pl.topRight.fields, separator: pl.topRight.separator };
        if (pl.topRight.prefix) tr.prefix = pl.topRight.prefix;
        if (pl.topRight.suffix) tr.suffix = pl.topRight.suffix;
        result.topRight = tr;
    }
    return result;
}

/** The filter `read` holds, with what it dropped told to `report`. */
function reportedFilter(read: FilterRead, report: ReportIssue | undefined, where = ''): FilterState {
    for (const issue of read.issues) report?.(`${where}${filterIssueText(issue)}`);
    return read.state;
}

function parsePinnedLists(raw: unknown[], report?: ReportIssue): PinnedListDefinition[] {
    const result: PinnedListDefinition[] = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== 'object') continue;
        const obj = entry as Record<string, unknown>;
        const name = typeof obj.name === 'string' ? obj.name : '';
        if (!name) continue;
        const id = (typeof obj.id === 'string' && obj.id)
            ? obj.id
            : newListId();

        if (!obj.filterState || typeof obj.filterState !== 'object') continue;
        const where = `list "${name}" `;
        const filterState = reportedFilter(FilterSerializer.parse(obj.filterState), report, where);

        // A list saved before the toggle was touched has no key: it reads as
        // false (the view filter is not applied). This is the one place the
        // default lives; everything past the codec sees a boolean.
        const applyViewFilter = obj.applyViewFilter === true;
        const def: PinnedListDefinition = { id, name, filterState, applyViewFilter };

        if (obj.sortState && typeof obj.sortState === 'object') {
            const sort = SortSerializer.parse(obj.sortState);
            for (const issue of sort.issues) report?.(`${where}sort ${sortIssueText(issue)}`);
            def.sortState = sort.state;
        }
        if (obj.topRight && typeof obj.topRight === 'object') {
            const tr = obj.topRight as Record<string, unknown>;
            if (Array.isArray(tr.fields)) {
                const fields = (tr.fields as unknown[]).filter((f): f is string => typeof f === 'string');
                if (fields.length > 0) {
                    def.topRight = {
                        fields,
                        separator: typeof tr.separator === 'string' ? tr.separator : '',
                        ...(typeof tr.prefix === 'string' && tr.prefix ? { prefix: tr.prefix } : {}),
                        ...(typeof tr.suffix === 'string' && tr.suffix ? { suffix: tr.suffix } : {}),
                    };
                }
            }
        }
        result.push(def);
    }
    return result;
}

function parseGrid(raw: unknown[], report?: ReportIssue): PinnedListDefinition[][] {
    const grid: PinnedListDefinition[][] = [];
    for (const row of raw) {
        if (!Array.isArray(row)) continue;
        const parsedRow = parsePinnedLists(row, report);
        if (parsedRow.length > 0) grid.push(parsedRow);
    }
    return grid;
}
