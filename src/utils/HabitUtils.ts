/**
 * HabitUtils
 *
 * Utility functions for habit key parsing and type inference.
 */

import type { HabitType } from '../types';

/**
 * Parse a frontmatter key that may contain a unit suffix.
 * e.g. "water[L]" → { displayName: "water", unit: "L" }
 *      "exercise" → { displayName: "exercise" }
 */
export function parseHabitKey(key: string): { displayName: string; unit?: string } {
    const match = key.match(/^(.+)\[(.+)\]$/);
    if (match) return { displayName: match[1], unit: match[2] };
    return { displayName: key };
}

/**
 * Infer HabitType from a frontmatter value.
 */
export function inferHabitType(value: unknown): HabitType {
    if (typeof value === 'boolean') return 'boolean';
    if (typeof value === 'number') return 'number';
    return 'string';
}
