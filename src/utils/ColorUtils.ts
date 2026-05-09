/**
 * Strip leading '#' from color values.
 * Accepts: '#ff0000' → 'ff0000', '#fff' → 'fff', 'red' → 'red'
 */
export function normalizeColor(raw: string): string {
    const trimmed = raw.trim();
    return trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
}

/**
 * Normalize any CSS color expression to 6-digit '#rrggbb'.
 * Returns '#000000' if value cannot be parsed.
 *
 * Uses Canvas 2D fillStyle as the parser, so no DOM mutation and no
 * dependency on getComputedStyle / window.
 */
export function cssColorToHex(value: string, doc: Document): string {
    let v = value.trim();
    if (!v) return '#000000';
    if (/^[0-9a-fA-F]{6}$/.test(v)) v = '#' + v;
    const ctx = doc.createElement('canvas').getContext('2d');
    if (!ctx) return '#000000';
    ctx.fillStyle = '#000000';
    ctx.fillStyle = v;
    return ctx.fillStyle as string;
}
