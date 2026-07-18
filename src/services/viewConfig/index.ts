/**
 * View configuration subsystem entry point.
 *
 * Pure barrel — re-exports only. Schema registration is triggered by
 * `views/registerAllSchemas.ts`, which must be imported at app startup
 * before any persistence boundary calls `codecFor()`.
 */

export type { ViewSchema, ConfigField, TransientField } from './ViewConfigSchema';
export { ViewConfigCodec } from './ViewConfigCodec';
export { F, T } from './FieldCodecs';
export {
    registerSchema,
    codecFor,
    schemaFor,
    resolveViewTypeFromShortName,
    shortNameFor,
    registeredViewTypes,
} from './SchemaRegistry';
