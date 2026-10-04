import { describe, it, expect } from 'vitest';
import { cssColorToHex } from '../../../src/utils/ColorUtils';

/**
 * `cssColorToHex` reads a color as the notation holds it for a picker. The
 * canvas that parses CSS colors is a stand-in here: it takes what a browser
 * takes (`#rgb`, `#rrggbb`, a name it knows) and gives `#rrggbb`, so what
 * is checked is what the function hands it.
 */
function docWithCanvas(): Document {
    const known: Record<string, string> = { red: '#ff0000' };
    const parse = (v: string): string | null => {
        const s = v.toLowerCase();
        if (/^#[0-9a-f]{6}$/.test(s)) return s;
        if (/^#[0-9a-f]{3}$/.test(s)) return '#' + [...s.slice(1)].map(c => c + c).join('');
        return known[s] ?? null;
    };
    return {
        createElement: () => ({
            getContext: () => {
                let style = '#000000';
                return {
                    get fillStyle() { return style; },
                    set fillStyle(v: string) { const p = parse(v); if (p) style = p; },
                };
            },
        }),
    } as unknown as Document;
}

describe('cssColorToHex', () => {
    const doc = docWithCanvas();

    it('reads a hex value of 6 or 3 digits without its #, as the notation holds it', () => {
        expect(cssColorToHex('ff8800', doc)).toBe('#ff8800');
        expect(cssColorToHex('f80', doc)).toBe('#ff8800');
    });

    it('reads a CSS color name and a value with its #', () => {
        expect(cssColorToHex('red', doc)).toBe('#ff0000');
        expect(cssColorToHex('#0a0', doc)).toBe('#00aa00');
    });

    it('is black for what does not read, and for nothing', () => {
        expect(cssColorToHex('nocolor', doc)).toBe('#000000');
        expect(cssColorToHex('  ', doc)).toBe('#000000');
    });
});
