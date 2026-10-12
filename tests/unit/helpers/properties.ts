import type { Properties, PropertyValue } from '../../../src/types';
import { PropertyKey } from '../../../src/services/parsing/utils/PropertyKey';

/** Properties written under the keys given, each key as written: what a layer that writes them reads. */
export function byKey(values: Record<string, PropertyValue>): Properties {
    const out: Properties = {};
    for (const [key, value] of Object.entries(values)) out[PropertyKey.fold(key)] = { key, value };
    return out;
}

/** Each property's value under its key as written: what a test compares. */
export function valuesOf(properties: Properties | undefined): Record<string, PropertyValue> {
    const out: Record<string, PropertyValue> = {};
    for (const { key, value } of Object.values(properties ?? {})) out[key] = value;
    return out;
}
