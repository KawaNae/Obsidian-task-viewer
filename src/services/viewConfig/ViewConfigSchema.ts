/**
 * ViewConfigSchema
 *
 * Per-view declarative schema for the canonical "view configuration" set
 * that round-trips through three persistence boundaries:
 *   - template `.md` file JSON block
 *   - Obsidian workspace state dict (setState/getState)
 *   - `obsidian://task-viewer` URI parameters
 *
 * One schema declares all fields once; serialize/parse/URI codecs read it.
 * Adding a new field is a single-line change to the per-view schema.
 *
 * `config` fields are persisted in template files, workspace state, AND URIs.
 * `transient` fields are workspace-state-only (e.g. navigation cursor,
 * collapse maps); they are never written to templates or URIs.
 */

export interface ConfigField<T> {
    /** Canonical key. Same string is used in template JSON, workspace state, and URI params. */
    readonly key: string;
    /** Parse an `unknown` dict value (from any source) into the typed value, or undefined to skip. */
    parse(raw: unknown): T | undefined;
    /** Serialize the typed value to a JSON-able value. Returning undefined omits the key from output. */
    serialize(value: T | undefined): unknown;
    /** Encode the typed value to a URI query string value. Default: JSON.stringify ∘ serialize, base64'd if complex. */
    toUriParam?(value: T): string | undefined;
    /** Decode a URI query string value back to the typed value. Pairs with toUriParam. */
    fromUriParam?(raw: string): T | undefined;
    /**
     * Legacy alternate keys (older versions used different names). Read-only:
     * parsing tries `key` first, then each legacyKey in order. Writes always use `key`.
     */
    readonly legacyKeys?: readonly string[];
}

export interface TransientField<T> {
    readonly key: string;
    parse(raw: unknown): T | undefined;
    serialize(value: T | undefined): unknown;
    readonly legacyKeys?: readonly string[];
}

export interface ViewSchema<
    TConfig extends object,
    TTransient extends object = Record<string, never>,
> {
    /** Obsidian view type, e.g. 'timeline-view'. Used by SchemaRegistry. */
    readonly viewType: string;
    /** URI shortName for `&view=<short>`, e.g. 'timeline'. */
    readonly shortName: string;
    /** Defaults applied on onReset and as the starting point for applyConfig. */
    readonly defaults: Partial<TConfig>;
    readonly config: { readonly [K in keyof TConfig]-?: ConfigField<NonNullable<TConfig[K]>> };
    readonly transient: { readonly [K in keyof TTransient]-?: TransientField<NonNullable<TTransient[K]>> };
    /** Transient field key used as the date anchor (the "Today" button target). */
    readonly anchorKey?: keyof TTransient & string;
}
