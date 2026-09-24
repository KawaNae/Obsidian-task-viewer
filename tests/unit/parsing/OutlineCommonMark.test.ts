import { describe, it, expect } from 'vitest';
import { Outline, type OutlineReading } from '../../../src/services/parsing/utils/Outline';
import fixture from './fixtures/l3-commonmark.json';

/**
 * `Outline.read` against CommonMark (commonmark.js 0.31.2) on the shapes L3
 * measured in Obsidian (`stages\l3-indent\measurement.md`, 235 shapes) and a
 * few more for the readings L3 changed. The fixture is written by
 * `verify-scripts/l3-cm-fixture.js`; its head names the generator and the
 * version it read with.
 *
 * An item is `[line, end, parent]`: `end` just past its last line that is
 * not blank. `owners` gives, per line that is not blank, the innermost item
 * it stands in.
 *
 * The outline keeps one exception from CommonMark: a fence opened in an item
 * goes on over shallower lines (L2). The shapes it shows in are listed with
 * the lines CommonMark gives to no item or to another one.
 */

type Item = [number, number, number | null];
interface Shape { lines: string[]; items: Item[]; owners: (number | null)[] }
const SHAPES = (fixture as unknown as { shapes: Record<string, Shape> }).shapes;

function itemsOf(outline: OutlineReading): Item[] {
    return outline.lines.flatMap((_, i) => {
        const item = outline.item(i);
        return item ? [[i, item.end, item.parent] as Item] : [];
    });
}

function ownersOf(outline: OutlineReading): (number | null)[] {
    return outline.lines.map((line, i) => (/^[ \t]*$/.test(line) ? null : outline.ownerOf(i)));
}

/**
 * The shapes both views read otherwise than CommonMark, the same way: a line
 * indented with a space before a tab (`  \t- [ ] T`). The outline reads
 * them as CommonMark does (2026-09-24): the one rule that says what both
 * views show also moves shapes only Live Preview reads so, and the reading
 * view agrees for a reason of its own (a tab is four columns to it).
 */
const SPACE_BEFORE_TAB = new Set([
    'D-S2t-s2', 'D-S2t-s4', 'D-S2t-s5', 'D-S2t-s6', 'D-S2t-s7', 'D-S2t-s8', 'D-S2t-s9', 'D-S2t-s10',
    'D-S2t-t', 'D-S2t-tt', 'D-S2t-S2t',
    'D-S3t-s2', 'D-S3t-s4', 'D-S3t-s5', 'D-S3t-s6', 'D-S3t-s7', 'D-S3t-s8', 'D-S3t-s9', 'D-S3t-s10',
    'D-S3t-t', 'D-S3t-tt', 'D-S3t-S2t',
    'D-tt-S2t', 'D-tS1-tS2', 'E-S2t-alone', 'E-S2t-then-Q', 'H-P-blank-S2t',
]);

/**
 * The shapes the fence exception (L2) reads otherwise than CommonMark, and
 * what the outline reads: the fence and the item go on over the shallower
 * line, and the closing delimiter closes the fence rather than opening one.
 */
const FENCE_EXCEPTION: Record<string, Pick<Shape, 'items' | 'owners'>> = {
    'X-L2-bk1': { items: [[0, 4, null], [4, 5, null]], owners: [0, 0, 0, 0, 4] },
    'X-L2-quote-in-fence': { items: [[0, 4, null], [4, 5, null]], owners: [0, 0, 0, 0, 4] },
};

function expectCommonMark(name: string, shape: Shape): void {
    const outline = Outline.read(shape.lines);
    expect(itemsOf(outline), name).toEqual(shape.items);
    expect(ownersOf(outline), name).toEqual(shape.owners);
}

describe('Outline.read reads what CommonMark reads (L3)', () => {
    for (const [name, shape] of Object.entries(SHAPES)) {
        if (SPACE_BEFORE_TAB.has(name) || name in FENCE_EXCEPTION) continue;
        it(`${name}: ${JSON.stringify(shape.lines)}`, () => expectCommonMark(name, shape));
    }
});

describe('Outline.read keeps its one exception from CommonMark (L2)', () => {
    for (const [name, read] of Object.entries(FENCE_EXCEPTION)) {
        it(name, () => {
            const shape = SHAPES[name];
            const outline = Outline.read(shape.lines);
            expect(itemsOf(outline)).toEqual(read.items);
            expect(ownersOf(outline)).toEqual(read.owners);
            // An exception only where CommonMark reads otherwise.
            expect([shape.items, shape.owners]).not.toEqual([read.items, read.owners]);
        });
    }
});

describe('Outline.read reads a space before a tab as CommonMark does, where both views read otherwise', () => {
    it('has every such shape in the fixture', () => {
        for (const name of SPACE_BEFORE_TAB) expect(SHAPES[name], name).toBeDefined();
    });
    for (const name of SPACE_BEFORE_TAB) {
        it(name, () => expectCommonMark(name, SHAPES[name]));
    }
});
