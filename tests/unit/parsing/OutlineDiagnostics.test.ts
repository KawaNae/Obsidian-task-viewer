import { describe, it, expect } from 'vitest';
import { Outline } from '../../../src/services/parsing/utils/Outline';
import { outlineDiagnostics } from '../../../src/services/parsing/utils/OutlineDiagnostics';
import fixture from './fixtures/l3-commonmark.json';

/**
 * The editor's two warnings on the note's reading: a `>` that ends an item
 * (the reading view keeps the quote and the lines below in it), and a fence
 * never closed (Live Preview draws code to the end of the note).
 */

const SHAPES = (fixture as unknown as { shapes: Record<string, { lines: string[] }> }).shapes;
const warned = (lines: string[], code: string) =>
    outlineDiagnostics(Outline.read(lines)).filter(d => d.code === code).map(d => d.line);

/**
 * The shapes the reading view draws a quote inside the item above, where
 * CommonMark and Live Preview end the item (`stages\l3-indent\measurement.md`),
 * and two more of the same kind.
 */
const QUOTE_IN_ITEM_ON_READING_VIEW: Record<string, number> = {
    'F-quote': 1, 'F-callout': 1, 'F-callout-c': 1, 'F-s3-18255': 2, 'F-quote-sib': 1, 'F-quote-tab': 1,
    'F-quote-nosp': 1, 'F-quote-after-child': 2, 'F-quote-para': 2, 'F-quote-lazy': 1,
    'H-quote-blank-c2': 1, 'H-quote-deep': 2,
    'X-quote-deep-lazy': 1, 'X-quote-empty': 1,
};

describe('outlineDiagnostics: a quote that ends an item', () => {
    for (const [name, shape] of Object.entries(SHAPES)) {
        const line = QUOTE_IN_ITEM_ON_READING_VIEW[name];
        it(`${name}: ${line === undefined ? 'no warning' : `a warning on line ${line}`}`, () => {
            expect(warned(shape.lines, 'outline.quote-ends-item')).toEqual(line === undefined ? [] : [line]);
        });
    }

    it('marks from the `>` to the end of the line', () => {
        const [d] = outlineDiagnostics(Outline.read(['- [ ] T', '  - [ ] c', ' > q']));
        expect([d.code, d.severity, d.line, d.span]).toEqual(['outline.quote-ends-item', 'warning', 2, { start: 1, end: 4 }]);
    });

    it('does not warn after a blank line, in the item\'s own column, or in a fence that takes the line', () => {
        expect(warned(['- [ ] T', '', '> q'], 'outline.quote-ends-item')).toEqual([]);
        expect(warned(['- [ ] T', '  > q'], 'outline.quote-ends-item')).toEqual([]);
        expect(warned(['- [ ] T', '  ```', '> q', '  ```'], 'outline.quote-ends-item')).toEqual([]);
        expect(warned(['para', '> q'], 'outline.quote-ends-item')).toEqual([]);
    });

    it('warns once, on the `>` that ends the item, not on the quote\'s lines after it', () => {
        expect(warned(['- [ ] T', '> a', '> b', '  - [ ] c'], 'outline.quote-ends-item')).toEqual([1]);
    });
});

describe('outlineDiagnostics: a fence never closed', () => {
    for (const [name, shape] of Object.entries(SHAPES)) {
        const unclosed = Outline.read(shape.lines).fences.filter(f => f.close === null).map(f => f.line);
        it(`${name}: ${unclosed.length === 0 ? 'no warning' : `a warning on ${unclosed.join(', ')}`}`, () => {
            expect(warned(shape.lines, 'outline.unclosed-fence')).toEqual(unclosed);
        });
    }

    it('warns on every fence never closed: at the top, in an item, and a tv-gen block', () => {
        expect(warned(['- [ ] T', '```', '- [ ] U'], 'outline.unclosed-fence')).toEqual([1]);
        expect(warned(['- [ ] T', '  ```js', '  x', '- [ ] U'], 'outline.unclosed-fence')).toEqual([1]);
        expect(warned(['```tv-gen a', '- [ ] x'], 'outline.unclosed-fence')).toEqual([0]);
        expect(warned(['- [ ] T', '  ```', '  x', '  ```'], 'outline.unclosed-fence')).toEqual([]);
    });

    it('names the closing line with the opening delimiter\'s character and length', () => {
        const [d] = outlineDiagnostics(Outline.read(['- [ ] T', '  ~~~~ info', '  x']));
        expect([d.code, d.line, d.span, d.params]).toEqual(['outline.unclosed-fence', 1, { start: 2, end: 11 }, { fence: '~~~~' }]);
        expect(d.message).toContain('~~~~');
        const [b] = outlineDiagnostics(Outline.read(['- ````js', '  x']));
        expect([b.line, b.span.start, b.params]).toEqual([0, 2, { fence: '````' }]);
    });
});
