/**
 * View configuration subsystem entry point.
 *
 * Pure barrel — re-exports only. The string-keyed lookups read the view
 * table (`views/ViewDescriptors.ts`); nothing has to be registered first.
 */

export type { ViewSchema, ConfigField, TransientField } from './ViewConfigSchema';
export { ViewConfigCodec } from './ViewConfigCodec';
export { F, T } from './FieldCodecs';
export {
    codecFor,
    schemaFor,
    resolveViewTypeFromShortName,
    shortNameFor,
} from './SchemaRegistry';
