/**
 * Strip leading '#' from color values.
 * Accepts: '#ff0000' → 'ff0000', '#fff' → 'fff', 'red' → 'red'
 */
export function normalizeColor(raw: string): string {
    const trimmed = raw.trim();
    return trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
}
