/**
 * ViewConfigCodec
 *
 * Single transcription hub that all 5 persistence boundaries (template
 * Writer/Loader, view setState/getState, URI handler, URI builder) route
 * through. Per-view differences live entirely in the ViewSchema; this class
 * has zero per-view branches.
 */

import type { ViewSchema, ConfigField, TransientField } from './ViewConfigSchema';

type FieldDict<T> = { readonly [K in keyof T]-?: ConfigField<NonNullable<T[K]>> };
type TransientDict<T> = { readonly [K in keyof T]-?: TransientField<NonNullable<T[K]>> };

export class ViewConfigCodec<
    TConfig extends object,
    TTransient extends object = Record<string, never>,
> {
    constructor(readonly schema: ViewSchema<TConfig, TTransient>) {}

    /** Parse a JSON-like dict (workspace state, template JSON, URI dict) → typed config. */
    parseConfig(raw: Record<string, unknown> | undefined | null): Partial<TConfig> {
        const out: Partial<TConfig> = {};
        if (!raw || typeof raw !== 'object') return out;
        for (const k in this.schema.config) {
            const field = (this.schema.config as FieldDict<TConfig>)[k];
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
     * Reads canonical keys AND legacyKeys.
     */
    fromUriParams(params: Record<string, string> | undefined | null): Partial<TConfig> {
        const out: Partial<TConfig> = {};
        if (!params) return out;
        for (const k in this.schema.config) {
            const field = (this.schema.config as FieldDict<TConfig>)[k];
            for (const lookupKey of keysToTry(field)) {
                const raw = params[lookupKey];
                if (typeof raw !== 'string') continue;
                const decoded = field.fromUriParam
                    ? field.fromUriParam(raw)
                    : defaultFromUriParam(field, raw);
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

function defaultFromUriParam<T>(field: ConfigField<T>, raw: string): T | undefined {
    return field.parse(raw);
}
