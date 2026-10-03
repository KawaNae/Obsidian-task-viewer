/**
 * ViewConfigCodec
 *
 * Single transcription hub that all 5 persistence boundaries (template
 * Writer/Loader, view setState/getState, URI handler, URI builder) route
 * through. Per-view differences live entirely in the ViewSchema; this class
 * has zero per-view branches.
 */

import type { ViewSchema, ConfigField, TransientField, ConfigIssue, ReportIssue } from './ViewConfigSchema';

type FieldDict<T> = { readonly [K in keyof T]-?: ConfigField<NonNullable<T[K]>> };
type TransientDict<T> = { readonly [K in keyof T]-?: TransientField<NonNullable<T[K]>> };

export class ViewConfigCodec<
    TConfig extends object,
    TTransient extends object = Record<never, never>,
> {
    constructor(readonly schema: ViewSchema<TConfig, TTransient>) {}

    /**
     * Overlay a parsed config on the schema defaults (REPLACE semantics).
     *
     * Every view applies a config the same way: fields present in `cfg` win,
     * fields absent from it revert to the schema default rather than keeping
     * whatever the view happened to hold. The base view reads every state,
     * reset and template through it (`TaskViewerView.setState`, `resetPatch`,
     * `templatePatch`), so the rule lives in one place.
     *
     * Every field the schema declares is present in the result, holding
     * `undefined` when it has neither an incoming value nor a default. That
     * matters because the result is merged into the view's state: a missing
     * key would silently preserve the previous value, which is the opposite of
     * REPLACE. Fields with no default therefore clear rather than linger.
     */
    withDefaults(cfg: Partial<TConfig> | undefined | null): Partial<TConfig> {
        const out: Partial<TConfig> = {};
        for (const k in this.schema.config) {
            (out as Record<string, unknown>)[k] = undefined;
        }
        return Object.assign(out, this.schema.defaults, cfg ?? {});
    }

    /**
     * Parse a JSON-like dict (workspace state, template JSON, URI dict) → typed config.
     * What a field read but dropped is pushed onto `issues`.
     */
    parseConfig(raw: Record<string, unknown> | undefined | null, issues?: ConfigIssue[]): Partial<TConfig> {
        const out: Partial<TConfig> = {};
        if (!raw || typeof raw !== 'object') return out;
        for (const k in this.schema.config) {
            const field = (this.schema.config as FieldDict<TConfig>)[k];
            for (const lookupKey of keysToTry(field)) {
                if (Object.prototype.hasOwnProperty.call(raw, lookupKey)) {
                    const parsed = field.parse(raw[lookupKey], reporterFor(field, issues));
                    if (parsed !== undefined) {
                        (out as Record<string, unknown>)[k] = parsed;
                        break;
                    }
                }
            }
        }
        return out;
    }

    /** Serialize typed config → JSON-like dict. Omits undefined fields. */
    serializeConfig(config: Partial<TConfig> | undefined | null): Record<string, unknown> {
        const out: Record<string, unknown> = {};
        if (!config) return out;
        for (const k in this.schema.config) {
            const field = (this.schema.config as FieldDict<TConfig>)[k];
            const value = (config as Record<string, unknown>)[k];
            const serialized = field.serialize(value as never);
            if (serialized !== undefined) out[field.key] = serialized;
        }
        return out;
    }

    parseTransient(raw: Record<string, unknown> | undefined | null): Partial<TTransient> {
        const out: Partial<TTransient> = {};
        if (!raw || typeof raw !== 'object') return out;
        for (const k in this.schema.transient) {
            const field = (this.schema.transient as TransientDict<TTransient>)[k];
            for (const lookupKey of keysToTry(field)) {
                if (Object.prototype.hasOwnProperty.call(raw, lookupKey)) {
                    const parsed = field.parse(raw[lookupKey]);
                    if (parsed !== undefined) {
                        (out as Record<string, unknown>)[k] = parsed;
                        break;
                    }
                }
            }
        }
        return out;
    }

    /** The transient fields that say where the view is: the anchor and the fields laid over it. */
    positionKeys(): readonly string[] {
        const { anchorKey, anchorOffsetKeys } = this.schema;
        return anchorKey ? [anchorKey, ...(anchorOffsetKeys ?? [])] : [];
    }

    /**
     * The transient fields a state sets over the ones a view has: the fields
     * it holds and can read, and, when it names where the view is, every
     * position field, one it lacks cleared. A URI's `date=` thus shows that
     * day's month grid even over a Calendar moved by weeks.
     */
    transientOfState(raw: Record<string, unknown> | undefined | null): Partial<TTransient> {
        const out = this.parseTransient(raw) as Record<string, unknown>;
        const position = this.positionKeys();
        if (position.some(key => key in out)) {
            for (const key of position) if (!(key in out)) out[key] = undefined;
        }
        return out as Partial<TTransient>;
    }

    serializeTransient(transient: Partial<TTransient> | undefined | null): Record<string, unknown> {
        const out: Record<string, unknown> = {};
        if (!transient) return out;
        for (const k in this.schema.transient) {
            const field = (this.schema.transient as TransientDict<TTransient>)[k];
            const value = (transient as Record<string, unknown>)[k];
            const serialized = field.serialize(value as never);
            if (serialized !== undefined) out[field.key] = serialized;
        }
        return out;
    }

    /**
     * Encode typed config to URI query param dict ({ key: stringValue }).
     * Caller is responsible for stringifying / joining.
     */
    toUriParams(config: Partial<TConfig> | undefined | null): Record<string, string> {
        const out: Record<string, string> = {};
        if (!config) return out;
        for (const k in this.schema.config) {
            const field = (this.schema.config as FieldDict<TConfig>)[k];
            const value = (config as Record<string, unknown>)[k];
            if (value === undefined || value === null) continue;
            const encoded = field.toUriParam
                ? field.toUriParam(value as never)
                : defaultUriParam(field, value as never);
            if (encoded !== undefined) out[field.key] = encoded;
        }
        return out;
    }

    /**
     * Decode URI query string dict ({ key: stringValue }) → typed config.
     * Reads canonical keys AND legacyKeys. What a field read but dropped is
     * pushed onto `issues`.
     */
    fromUriParams(params: Record<string, string> | undefined | null, issues?: ConfigIssue[]): Partial<TConfig> {
        const out: Partial<TConfig> = {};
        if (!params) return out;
        for (const k in this.schema.config) {
            const field = (this.schema.config as FieldDict<TConfig>)[k];
            for (const lookupKey of keysToTry(field)) {
                const raw = params[lookupKey];
                if (typeof raw !== 'string') continue;
                const report = reporterFor(field, issues);
                const decoded = field.fromUriParam
                    ? field.fromUriParam(raw, report)
                    : defaultFromUriParam(field, raw, report);
                if (decoded !== undefined) {
                    (out as Record<string, unknown>)[k] = decoded;
                    break;
                }
            }
        }
        return out;
    }
}

function keysToTry<T>(field: ConfigField<T> | TransientField<T>): string[] {
    return field.legacyKeys && field.legacyKeys.length > 0
        ? [field.key, ...field.legacyKeys]
        : [field.key];
}

function defaultUriParam<T>(field: ConfigField<T>, value: T): string | undefined {
    const serialized = field.serialize(value);
    if (serialized === undefined) return undefined;
    if (typeof serialized === 'string') return serialized;
    if (typeof serialized === 'number' || typeof serialized === 'boolean') return String(serialized);
    return undefined;  // Complex types must opt in via toUriParam to choose encoding strategy.
}

function defaultFromUriParam<T>(field: ConfigField<T>, raw: string, report?: ReportIssue): T | undefined {
    return field.parse(raw, report);
}

function reporterFor<T>(field: ConfigField<T>, issues: ConfigIssue[] | undefined): ReportIssue | undefined {
    return issues ? text => issues.push({ field: field.key, text }) : undefined;
}
