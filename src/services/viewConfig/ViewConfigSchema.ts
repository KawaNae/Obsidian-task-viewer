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

import type { PinnedListDefinition } from '../../types';
import type { ViewType } from '../../views/ViewDescriptors';

/**
 * Tells of a part of a value a field read but dropped (a filter condition, a
 * sort rule), in an English sentence. A field reads what it can and reports
 * the rest; a value it cannot read at all is undefined, as before.
 */
export type ReportIssue = (text: string) => void;

/** A part of a config that was dropped on read: the field and what was dropped. */
export interface ConfigIssue {
    readonly field: string;
    readonly text: string;
}

export interface ConfigField<T> {
    /** Canonical key. Same string is used in template JSON, workspace state, and URI params. */
    readonly key: string;
    /** Parse an `unknown` dict value (from any source) into the typed value, or undefined to skip. */
    parse(raw: unknown, report?: ReportIssue): T | undefined;
    /** Serialize the typed value to a JSON-able value. Returning undefined omits the key from output. */
    serialize(value: T | undefined): unknown;
    /** Encode the typed value to a URI query string value. Default: JSON.stringify ∘ serialize, base64'd if complex. */
    toUriParam?(value: T): string | undefined;
    /** Decode a URI query string value back to the typed value. Pairs with toUriParam. */
    fromUriParam?(raw: string, report?: ReportIssue): T | undefined;
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
    TTransient extends object = Record<never, never>,
> {
    /** Obsidian view type, e.g. 'timeline-view'. The view table reads it from here. */
    readonly viewType: ViewType;
    /** URI shortName for `&view=<short>`, e.g. 'timeline'. */
    readonly shortName: string;
    /** The config's defaults: what a reset gives, and what a state, a URI or a template is laid over. */
    readonly defaults: Partial<TConfig>;
    readonly config: { readonly [K in keyof TConfig]-?: ConfigField<NonNullable<TConfig[K]>> };
    readonly transient: { readonly [K in keyof TTransient]-?: TransientField<NonNullable<TTransient[K]>> };
    /**
     * The transient field that holds the day the view looks at (absent:
     * following today). The CLI's `anchor-date` is written to it.
     */
    readonly anchorKey?: keyof TTransient & string;
    /**
     * The pinned lists a config of this view holds, in the order the view
     * shows them; a view without lists has none. A template's lists are read
     * through here (`PinnedListQuery.fromTemplate`), so only the schema knows
     * where they are kept (a flat list, or Kanban's grid).
     */
    readonly listsOf?: (config: Partial<TConfig>) => readonly PinnedListDefinition[];
}
