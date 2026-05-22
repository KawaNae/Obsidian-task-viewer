/**
 * SchemaRegistry
 *
 * Single source of truth mapping `viewType` → ViewSchema → ViewConfigCodec.
 * `codecFor()` is the only entry point used by the 5 persistence boundaries.
 *
 * Adding a new view: declare its `<View>Schema.ts`, import it here, add to
 * VIEW_SCHEMAS. No other location needs to change.
 */

import type { ViewSchema } from './ViewConfigSchema';
import { ViewConfigCodec } from './ViewConfigCodec';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySchema = ViewSchema<any, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCodec = ViewConfigCodec<any, any>;

/**
 * Internal registry. Populated by per-view modules calling registerSchema()
 * at import time. We use registration rather than a hard-coded map so a
 * view's schema lives next to its view code (better cohesion) and the
 * registry has no inverse import dependency on the views/ tree.
 */
const SCHEMAS: Map<string, AnySchema> = new Map();
const CODECS: Map<string, AnyCodec> = new Map();
const SHORT_NAME_TO_TYPE: Map<string, string> = new Map();

export function registerSchema(schema: AnySchema): void {
    SCHEMAS.set(schema.viewType, schema);
    CODECS.set(schema.viewType, new ViewConfigCodec(schema));
    SHORT_NAME_TO_TYPE.set(schema.shortName, schema.viewType);
}

export function codecFor(viewType: string): AnyCodec | undefined {
    return CODECS.get(viewType);
}

export function schemaFor(viewType: string): AnySchema | undefined {
    return SCHEMAS.get(viewType);
}

export function resolveViewTypeFromShortName(shortName: string): string | undefined {
    return SHORT_NAME_TO_TYPE.get(shortName);
}

export function shortNameFor(viewType: string): string | undefined {
    return SCHEMAS.get(viewType)?.shortName;
}

/** All registered view types (used for tests and iteration). */
export function registeredViewTypes(): string[] {
    return Array.from(SCHEMAS.keys());
}
