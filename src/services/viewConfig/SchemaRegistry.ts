/**
 * SchemaRegistry
 *
 * The string-keyed lookups of a view's schema and codec, for the boundaries
 * that hold only a name: a URI, the CLI, a template file, a pinned list's
 * query. They read the view table (`VIEW_DESCRIPTORS`); a caller that knows
 * its view imports that view's codec (`TimelineCodec`, …) instead.
 */

import type { ViewSchema } from './ViewConfigSchema';
import type { ViewConfigCodec } from './ViewConfigCodec';
import { ALL_VIEWS, descriptorOf, type ViewType } from '../../views/ViewDescriptors';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySchema = ViewSchema<any, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyCodec = ViewConfigCodec<any, any>;

export function codecFor(viewType: string): AnyCodec | undefined {
    return descriptorOf(viewType)?.codec;
}

export function schemaFor(viewType: string): AnySchema | undefined {
    return descriptorOf(viewType)?.schema;
}

export function resolveViewTypeFromShortName(shortName: string): ViewType | undefined {
    return ALL_VIEWS.find(d => d.shortName === shortName)?.type;
}

export function shortNameFor(viewType: string): string | undefined {
    return descriptorOf(viewType)?.shortName;
}
