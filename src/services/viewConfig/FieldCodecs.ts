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
 */

import type { ConfigField, TransientField } from './ViewConfigSchema';
import type { FilterState } from '../filter/FilterTypes';
import { hasConditions } from '../filter/FilterTypes';
import { FilterSerializer } from '../filter/FilterSerializer';
import { unicodeBtoa, unicodeAtob } from '../../utils/base64';
import type { PinnedListDefinition, AstronomyDisplay } from '../../types';
import type { SortRule } from '../sort/SortTypes';

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
                if (raw === 'true') return true;
                if (raw === 'false') return false;
                return undefined;
            },
            serialize(value) {
                return typeof value === 'boolean' ? value : undefined;
            },
            toUriParam(value) {
                return value ? 'true' : 'false';
            },
            fromUriParam(raw) {
                if (raw === 'true') return true;
                if (raw === 'false') return false;
                return undefined;
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

    intEnum<const N extends number>(
        key: string,
        allowed: readonly N[],
        opts: FieldOptions = {},
    ): ConfigField<N> {
        const set = new Set<number>(allowed);
        const parseValue = (v: number): N | undefined => (set.has(v) ? (v as N) : undefined);
        return {
            key,
            legacyKeys: opts.legacyKeys,
            parse(raw) {
                if (typeof raw === 'number') return parseValue(raw);
                if (typeof raw === 'string') {
                    const n = parseInt(raw, 10);
                    return Number.isFinite(n) ? parseValue(n) : undefined;
                }
                return undefined;
            },
            serialize(value) {
                return typeof value === 'number' && set.has(value) ? value : undefined;
            },
            toUriParam(value) { return String(value); },
            fromUriParam(raw) {
                const n = parseInt(raw, 10);
                return Number.isFinite(n) ? parseValue(n) : undefined;
            },
        };
    },

    stringEnum<const S extends string>(
        key: string,
        allowed: readonly S[],
        opts: FieldOptions = {},
    ): ConfigField<S> {
        const set = new Set<string>(allowed);
        const parseValue = (v: string): S | undefined => (set.has(v) ? (v as S) : undefined);
        return {
            key,
            legacyKeys: opts.legacyKeys,
            parse(raw) {
                return typeof raw === 'string' ? parseValue(raw) : undefined;
            },
            serialize(value) {
                return typeof value === 'string' && set.has(value) ? value : undefined;
            },
            toUriParam(value) { return String(value); },
            fromUriParam(raw) { return parseValue(raw); },
        };
    },

    float(
        key: string,
        opts: FieldOptions & { min?: number; max?: number } = {},
    ): ConfigField<number> {
        const { min = -Infinity, max = Infinity } = opts;
        const check = (n: number): number | undefined =>
            (Number.isFinite(n) && n >= min && n <= max) ? n : undefined;
        return {
            key,
            legacyKeys: opts.legacyKeys,
            parse(raw) {
                if (typeof raw === 'number') return check(raw);
                if (typeof raw === 'string') {
                    const n = parseFloat(raw);
                    return Number.isFinite(n) ? check(n) : undefined;
                }
                return undefined;
            },
            serialize(value) {
                return typeof value === 'number' ? check(value) : undefined;
            },
            toUriParam(value) { return String(value); },
            fromUriParam(raw) {
                const n = parseFloat(raw);
                return Number.isFinite(n) ? check(n) : undefined;
            },
        };
    },

    /**
     * FilterState. Workspace state and template JSON store the serialized JSON
     * form (FilterSerializer.toJSON). URI form is base64-encoded JSON.
     * Empty filter states (no conditions) are omitted entirely.
     */
    filter(key: string, opts: FieldOptions = {}): ConfigField<FilterState> {
        return {
            key,
            legacyKeys: opts.legacyKeys,
            parse(raw) {
                if (!raw || typeof raw !== 'object') return undefined;
                const state = FilterSerializer.fromJSON(raw);
                return hasConditions(state) ? state : undefined;
            },
            serialize(value) {
                if (!value || !hasConditions(value)) return undefined;
                return FilterSerializer.toJSON(value);
            },
            toUriParam(value) {
                return hasConditions(value) ? FilterSerializer.toURIParam(value) : undefined;
            },
            fromUriParam(raw) {
                const state = FilterSerializer.fromURIParam(raw);
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
            parse(raw) {
                if (!Array.isArray(raw)) return undefined;
                const result = parsePinnedLists(raw);
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
            fromUriParam(raw) {
                const decoded = tryDecodeBase64Json(raw);
                if (!Array.isArray(decoded)) return undefined;
                const result = parsePinnedLists(decoded);
                return result.length > 0 ? result : undefined;
            },
        };
    },

    grid(key: string, opts: FieldOptions = {}): ConfigField<PinnedListDefinition[][]> {
        return {
            key,
            legacyKeys: opts.legacyKeys,
            parse(raw) {
                if (!Array.isArray(raw)) return undefined;
                const grid = parseGrid(raw);
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
            fromUriParam(raw) {
                const decoded = tryDecodeBase64Json(raw);
                if (!Array.isArray(decoded)) return undefined;
                const grid = parseGrid(decoded);
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

    /** YYYY-MM-DD string. */
    dateString(key: string, opts: FieldOptions = {}): ConfigField<string> {
        const VALID = /^\d{4}-\d{2}-\d{2}$/;
        return {
            key,
            legacyKeys: opts.legacyKeys,
            parse(raw) {
                return typeof raw === 'string' && VALID.test(raw) ? raw : undefined;
            },
            serialize(value) {
                return typeof value === 'string' && VALID.test(value) ? value : undefined;
            },
            toUriParam(value) {
                return VALID.test(value) ? value : undefined;
            },
            fromUriParam(raw) {
                return VALID.test(raw) ? raw : undefined;
            },
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

    boolean(key: string, opts: TransientOpts = {}): TransientField<boolean> {
        const f = F.boolean(key, opts);
        return { key: f.key, parse: f.parse, serialize: f.serialize, legacyKeys: opts.legacyKeys };
    },

    /**
     * Record<string, boolean> for collapse maps. Only `true` entries are
     * persisted (the per-view convention prior to this refactor).
     *
     * Optional `viewIdPrefix` handles the legacy un-prefixed key migration
     * (`listId` → `${viewIdPrefix}::${listId}`). When set, parse migrates old
     * entries; serialize emits only already-prefixed keys.
     */
    collapsedKeys(
        key: string,
        viewIdPrefix?: string,
        opts: TransientOpts = {},
    ): TransientField<Record<string, boolean>> {
        const prefix = viewIdPrefix ? `${viewIdPrefix}::` : '';
        return {
            key,
            legacyKeys: opts.legacyKeys,
            parse(raw) {
                if (!raw || typeof raw !== 'object') return undefined;
                const out: Record<string, boolean> = {};
                for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
                    if (v !== true) continue;
                    const normalized = (prefix && !k.includes('::')) ? `${prefix}${k}` : k;
                    out[normalized] = true;
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
    };
    if (pl.sortState) {
        result.sortState = {
            rules: pl.sortState.rules.map(r => ({
                id: r.id,
                property: r.property,
                direction: r.direction,
            })),
        };
    }
    if (pl.applyViewFilter !== undefined) result.applyViewFilter = pl.applyViewFilter;
    if (pl.topRight && pl.topRight.fields.length > 0) {
        result.topRight = { fields: pl.topRight.fields, separator: pl.topRight.separator };
    }
    return result;
}

function parsePinnedLists(raw: unknown[]): PinnedListDefinition[] {
    const result: PinnedListDefinition[] = [];
    for (const entry of raw) {
        if (!entry || typeof entry !== 'object') continue;
        const obj = entry as Record<string, unknown>;
        const name = typeof obj.name === 'string' ? obj.name : '';
        if (!name) continue;
        const id = (typeof obj.id === 'string' && obj.id)
            ? obj.id
            : 'pl-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5);

        if (!obj.filterState || typeof obj.filterState !== 'object') continue;
        const filterState = FilterSerializer.fromJSON(obj.filterState);

        const def: PinnedListDefinition = { id, name, filterState };

        if (obj.sortState && typeof obj.sortState === 'object') {
            const rawSort = obj.sortState as Record<string, unknown>;
            if (Array.isArray(rawSort.rules)) {
                def.sortState = {
                    rules: (rawSort.rules as Record<string, unknown>[]).map(r => ({
                        id: (typeof r.id === 'string' && r.id)
                            ? r.id
                            : `s-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                        property: r.property as SortRule['property'],
                        direction: r.direction as SortRule['direction'],
                    })),
                };
            }
        }
        if (typeof obj.applyViewFilter === 'boolean') def.applyViewFilter = obj.applyViewFilter;
        if (obj.topRight && typeof obj.topRight === 'object') {
            const tr = obj.topRight as Record<string, unknown>;
            if (Array.isArray(tr.fields)) {
                const fields = (tr.fields as unknown[]).filter((f): f is string => typeof f === 'string');
                if (fields.length > 0) {
                    def.topRight = { fields, separator: typeof tr.separator === 'string' ? tr.separator : '' };
                }
            }
        }
        result.push(def);
    }
    return result;
}

function parseGrid(raw: unknown[]): PinnedListDefinition[][] {
    const grid: PinnedListDefinition[][] = [];
    for (const row of raw) {
        if (!Array.isArray(row)) continue;
        const parsedRow = parsePinnedLists(row);
        if (parsedRow.length > 0) grid.push(parsedRow);
    }
    return grid;
}
