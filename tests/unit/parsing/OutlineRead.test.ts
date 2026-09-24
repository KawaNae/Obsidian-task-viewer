import { describe, it, expect } from 'vitest';
import { Outline, type OutlineReading } from '../../../src/services/parsing/utils/Outline';
import { checkWrite, type WrittenLine } from '../../../src/services/parsing/utils/OutlineCheck';

/**
 * `Outline.read` against what Obsidian 1.12.4 reads of the same notes
 * (`stages\l2-blocks\measurement.md`, questions 1-16). Each shape is one the
 * measurement wrote to a note, and the expected items and code lines are the
 * ones its `listItems`, `sections` and reading view gave.
 *
 * An item here is `[line, end, parent]`: `end` is the index just past its
 * subtree (its children included, the blank lines at its end not), `parent`
 * the line of the item it stands in or null at the top. Obsidian's
 * `listItems` gives an item's own lines without its children; the starts,
 * the parents and the ends of the items with no children are the same
 * numbers.
 */

const TAB = '\t';
const IDEO = '　';
const NBSP = ' ';
const F = '```';

type Item = [line: number, end: number, parent: number | null];

function itemsOf(outline: OutlineReading): Item[] {
    return outline.lines.flatMap((_, i) => {
        const item = outline.item(i);
        return item ? [[i, item.end, item.parent] as Item] : [];
    });
}

function codeOf(outline: OutlineReading): string {
    return outline.codeMask().map(code => (code ? '1' : '0')).join('');
}

const MEASURED: Array<{ q: string; name: string; lines: string[]; items: Item[]; code: string }> = [
    {
        q: 'q1', name: 'BK1: a fence in an item takes a shallower line, and the item with it',
        lines: ['- [ ] task', `    ${F}`, 'shallow content at column 0', `    ${F}`, '- [ ] sibling'],
        items: [[0, 4, null], [4, 5, null]], code: '01110',
    },
    {
        q: 'q1', name: 'BK1 indented with a tab',
        lines: ['- [ ] task', `${TAB}${F}`, 'shallow', `${TAB}${F}`, '- [ ] sibling'],
        items: [[0, 4, null], [4, 5, null]], code: '01110',
    },
    {
        q: 'q1', name: 'a task as deep as the child, in the child\'s fence, ends the fence',
        lines: ['- [ ] root', `${TAB}- [ ] child`, `${TAB}${TAB}${F}`, `${TAB}- [ ] same depth as child inside fence`, `${TAB}${TAB}${F}`, `${TAB}- [ ] after`, '- [ ] sibling'],
        items: [[0, 6, null], [1, 3, 0], [3, 5, 0], [5, 6, 0], [6, 7, null]], code: '0010100',
    },
    {
        q: 'q2', name: 'R5: a fence that never closes ends with its item, and the sibling is a task',
        lines: ['- [ ] root', `    ${F}`, '    unclosed fence body', '- [ ] sibling', '- [ ] sibling2'],
        items: [[0, 3, null], [3, 4, null], [4, 5, null]], code: '01100',
    },
    {
        q: 'q2', name: 'R5 in a child',
        lines: ['- [ ] root', `${TAB}- [ ] child`, `${TAB}${TAB}${F}`, `${TAB}${TAB}body`, '- [ ] sibling'],
        items: [[0, 4, null], [1, 4, 0], [4, 5, null]], code: '00110',
    },
    {
        q: 'q3', name: 'a line shallower than the content column is at the top',
        lines: ['- [ ] a', ' - [ ] b (1 space)', '- [ ] c', '1. [ ] d', '  - [ ] e (2 spaces under 1.)', '   - [ ] f (3 spaces under 1.)'],
        items: [[0, 1, null], [1, 2, null], [2, 3, null], [3, 4, null], [4, 5, null], [5, 6, null]], code: '000000',
    },
    {
        q: 'q4', name: 'four columns past the content column is the paragraph going on, or code after a blank line',
        lines: ['- [ ] a', '      - [ ] b (6 spaces)', '- [ ] c', '', '      - [ ] d (6 spaces after blank)', '- [ ] e', `${TAB}${TAB}- [ ] f (two tabs)`],
        items: [[0, 2, null], [2, 5, null], [5, 7, null]], code: '0000100',
    },
    {
        q: 'q5', name: 'a paragraph line at column 0, U+3000 or NBSP, or `-[ ] x`, goes on and keeps the children below',
        lines: ['- [ ] P', `${TAB}- [ ] c1`, 'memo at column 0', `${TAB}- [ ] c2`, '- [ ] Q', `${IDEO}memo ideographic`, `${TAB}- [ ] q1`, '- [ ] R', `${NBSP}memo nbsp`, `${TAB}- [ ] r1`, '-[ ] not an item', `${TAB}- [ ] r2`],
        items: [[0, 4, null], [1, 3, 0], [3, 4, 0], [4, 7, null], [6, 7, 4], [7, 12, null], [9, 11, 7], [11, 12, 7]], code: '000000000000',
    },
    {
        q: 'q6', name: 'after a blank line, one column in is at the top and two or a tab are children',
        lines: ['- [ ] A', '', ' - ==> every mon (1 space after blank)', '- [ ] B', '', '  - [ ] b2 (2 spaces after blank)', '- [ ] C', '', `${TAB}- [ ] c2 (tab after blank)`],
        items: [[0, 1, null], [2, 3, null], [3, 6, null], [5, 6, 3], [6, 9, null], [8, 9, 6]], code: '000000000',
    },
    {
        q: 'q7', name: 'a line of only U+3000, NBSP or a tab is blank',
        lines: ['- [ ] A', `${TAB}- [ ] a1`, IDEO, `${TAB}- [ ] a2`, '- [ ] B', NBSP, 'memo', '- [ ] C', TAB, 'x at column 0'],
        items: [[0, 4, null], [1, 2, 0], [3, 4, 0], [4, 5, null], [7, 8, null]], code: '0000000000',
    },
    {
        q: 'q8', name: 'a delimiter six columns in goes on the paragraph; one at column 0 opens a fence of its own',
        lines: ['- [ ] A', `      ${F}`, '      code?', `      ${F}`, '- [ ] B', `  ${F}`, '  inside', `  ${F}`, '- [ ] C', `  ${F}`, 'x', F, '- [ ] D'],
        items: [[0, 4, null], [4, 8, null], [8, 11, null]], code: '0000011101111',
    },
    {
        q: 'q9', name: 'a marker with no space or tab after it opens no item',
        lines: ['- [ ] A', `${TAB}-==> every mon`, `${TAB}-${NBSP}==> every tue`, `${TAB}-${IDEO}==> every wed`, `${TAB}- ==> every thu`, '- [ ] B', `${TAB}-[ ] b1`],
        items: [[0, 5, null], [4, 5, 0], [5, 7, null]], code: '0000000',
    },
    {
        q: 'q10', name: 'a tab task after a heading or a rule is indented code; a table goes on the paragraph',
        lines: ['- [ ] A', `${TAB}- [ ] a1`, '# heading', `${TAB}- [ ] a2`, '- [ ] B', '---', `${TAB}- [ ] b1`, '- [ ] C', '| x | y |', '| - | - |', `${TAB}- [ ] c1`],
        items: [[0, 2, null], [1, 2, 0], [4, 5, null], [7, 11, null], [10, 11, 7]], code: '00010010000',
    },
    {
        q: 'q11', name: 'a heading at column 0 ends the item and its fence; the delimiter after opens a fence to the end',
        lines: ['- [ ] T', `  ${F}`, '# x', `  ${F}`, `${TAB}- [ ] C`, '- [ ] U'],
        items: [[0, 2, null]], code: '010111',
    },
    {
        q: 'q12', name: 'a thematic break at column 0 does the same',
        lines: ['- [ ] T', `  ${F}`, '***', `  ${F}`, '- [ ] U'],
        items: [[0, 2, null]], code: '01011',
    },
    {
        q: 'q13', name: 'a shallower line after a blank line ends the item and its fence',
        lines: ['- [ ] T', `  ${F}`, 'a', '', 'b at col 0', `  ${F}`, '- [ ] U'],
        items: [[0, 3, null]], code: '0111011',
    },
    {
        q: 'q14', name: 'a fence that never closes takes a line at column 0, and a sibling ends it',
        lines: ['- [ ] R', `    ${F}`, '    body', 'text col0', '- [ ] S'],
        items: [[0, 4, null], [4, 5, null]], code: '01110',
    },
    {
        q: 'q15', name: 'a line of U+3000 or NBSP between a task and its tab child is blank',
        lines: ['- [ ] A', IDEO, 'memo', '- [ ] C', NBSP, `${TAB}- [ ] c1`, '- [ ] D', IDEO, `${TAB}- [ ] d1`],
        items: [[0, 1, null], [3, 6, null], [5, 6, 3], [6, 9, null], [8, 9, 6]], code: '000000000',
    },
    {
        q: 'q16', name: 'a `>` at column 0 in the fence goes on the fence',
        lines: ['- [ ] T', `  ${F}`, '> q', `  ${F}`, '- [ ] U'],
        items: [[0, 4, null], [4, 5, null]], code: '01110',
    },
];

describe('Outline.read reads what Obsidian reads (measurement.md)', () => {
    for (const shape of MEASURED) {
        it(`${shape.q}: ${shape.name}`, () => {
            const outline = Outline.read(shape.lines);
            expect(itemsOf(outline)).toEqual(shape.items);
            expect(codeOf(outline)).toBe(shape.code);
        });
    }
});

describe('OutlineReading', () => {
    it('gives each line the innermost item it stands in', () => {
        const outline = Outline.read(['- [ ] a', '\t- [ ] b', '\t\tmemo', '', '\tmemo of a', 'text', '', 'prose']);
        expect([0, 1, 2, 3, 4, 5, 6, 7].map(i => outline.ownerOf(i))).toEqual([0, 1, 1, 1, 0, 0, 0, null]);
    });

    it('reads nothing inside the frontmatter', () => {
        const outline = Outline.read(['---', '- [ ] not a task', '```', '---', '- [ ] a']);
        expect(itemsOf(outline)).toEqual([[4, 5, null]]);
        expect(codeOf(outline)).toBe('00000');
    });

    it('has no subtree for a line that opens no item', () => {
        const outline = Outline.read(['text', '- [ ] a']);
        expect(outline.subtreeEnd(0)).toBe(1);
    });

    it('opens no item on a line in code, in every shape measured', () => {
        // The readers that ask for an item under a task ask nothing more of
        // code (ownPropertyLines, collectFlowLineIndices, opensTask).
        for (const shape of MEASURED) {
            const outline = Outline.read(shape.lines);
            const both = shape.lines.map((_, i) => i).filter(i => outline.item(i) !== null && outline.inCode(i));
            expect(both, shape.name).toEqual([]);
        }
    });

    it('puts the content after a gap of four columns, and one column past the marker after five', () => {
        // CommonMark: five columns or more after the marker is indented code
        // in the item, and its content starts one column past the marker.
        const four = Outline.read(['-    a', '     child']);
        expect(four.item(0)!.contentColumn).toBe(5);
        expect(four.ownerOf(1)).toBe(0);
        const five = Outline.read(['-     a', '  - [ ] b']);
        expect(five.item(0)!.contentColumn).toBe(2);
        expect(five.item(1)!.parent).toBe(0);
    });

    /** Whether taking `rows` out of the note leaves the rest as it was (`checkWrite`). */
    function takesOut(reading: OutlineReading, rows: number[]): boolean {
        const gone = new Set(rows);
        const kept = reading.lines.map((_, i) => i).filter(i => !gone.has(i));
        const written: WrittenLine[] = kept.map(from => ({ kind: 'kept', from }));
        return checkWrite(reading, Outline.read(kept.map(i => reading.lines[i])), written, []) === 'sound';
    }

    it('takes a line out only when every other line reads as the same kind without it', () => {
        const outline = Outline.read(['- [ ] T', '\t- memo:: a', '\t\t- [ ] sub', '\t- k:: v', 'lazy', '\t- [ ] c']);
        // sub is too deep for T without memo: a paragraph line, no item.
        expect(takesOut(outline, [1])).toBe(false);
        // `lazy` goes on sub's paragraph instead: a paragraph line either way.
        expect(takesOut(outline, [3])).toBe(true);
        expect(takesOut(outline, [5])).toBe(true);
        // A child that still reaches an item changes parent: T's own, or a
        // sibling's, and a command or a property would work for that task
        // (the third L2 counterexample run).
        for (const child of ['    - [ ] sub', '    - ==> every tue', '    - k:: v', '    - [[link]]']) {
            expect(takesOut(Outline.read(['- [ ] T', '  - memo:: a', child]), [1]), child).toBe(false);
            expect(takesOut(Outline.read(['- [ ] T', '  - [ ] B', '  - memo:: a', child]), [2]), child).toBe(false);
        }
    });

    it('lets a note bullet change parent, and not a task whose note bullet goes under a sibling', () => {
        // The note goes under T: nothing the plugin reads changes (the
        // fourth L2 counterexample run, U1 and U2), and a task under the note
        // keeps its parent and its task above.
        expect(takesOut(Outline.read(['- [ ] T', '  - ==> every mon', '    - why weekly']), [1])).toBe(true);
        expect(takesOut(Outline.read(['- [ ] T', '  - memo:: a', '    - detail', '      - [ ] sub']), [1])).toBe(true);
        // The note goes under B, and sub, still under the note, would be B's.
        const underSibling = Outline.read(['- [ ] T', '\t- [ ] B', '\t- memo:: a', '\t\t- note', '\t\t\t- [ ] sub']);
        expect(underSibling.item(3)!.parent).toBe(2);
        expect(takesOut(underSibling, [2])).toBe(false);
        expect(takesOut(Outline.read(['- [ ] T', '\t- [ ] B', '\t- memo:: a', '\t\t- note']), [2])).toBe(true);
    });

    it('does not take a line out when a fence below it would be indented code without it', () => {
        // The fence is two columns into memo's content; without memo it is
        // six into T's, past a blank line: indented code, `js` text (the
        // fourth L2 counterexample run, G1). Code either way, a fence only
        // before.
        const fence = ['- [ ] T', '    - memo:: a', '', '        ```js', '        x', '        ```', '- [ ] U'];
        const outline = Outline.read(fence);
        expect(outline.fences).toHaveLength(1);
        expect(Outline.read(fence.filter((_, i) => i !== 1)).fences).toEqual([]);
        expect(takesOut(outline, [1])).toBe(false);
        // And the other way: indented code in memo that would be a fence in
        // C, whose content starts at column 7.
        const indented = ['- [ ] T', '  -    [ ] C', '  - memo:: a', '', '        ```js', '        x', '        ```'];
        expect(Outline.read(indented).fences).toEqual([]);
        expect(Outline.read(indented.filter((_, i) => i !== 2)).fences).toHaveLength(1);
        expect(takesOut(Outline.read(indented), [2])).toBe(false);
    });
});

describe('OutlineReading.fences', () => {
    it('gives the opening line, the closing line, the info string, the column and where the delimiter starts', () => {
        const outline = Outline.read(['prose', '```tv-gen 週報の手順', '- [ ] 資料集め', '```', '- ```js', '  x', '  ```']);
        expect(outline.fences).toEqual([
            { line: 1, close: 3, end: 4, delimiter: '```', info: 'tv-gen 週報の手順', column: 0, from: 0 },
            { line: 4, close: 6, end: 7, delimiter: '```', info: 'js', column: 2, from: 2 },
        ]);
    });

    it('does not open a fence on a delimiter quoted inside a wider one', () => {
        // The shape every note explaining the notation has: an outer fence
        // wrapping a sample that itself contains a fence.
        const outline = Outline.read(['`````markdown', '```tv-gen 週報の手順', '- [ ] 資料集め', '```', '`````']);
        expect(outline.fences.map(fence => [fence.line, fence.close, fence.info])).toEqual([[0, 4, 'markdown']]);
        expect(codeOf(outline)).toBe('11111');
    });

    it('holds every line after a fence at the top that never closes', () => {
        const outline = Outline.read(['prose', '```tv-gen 週報', '- [ ] 資料集め', '', '- [ ] more']);
        expect(outline.fences.map(fence => [fence.line, fence.close])).toEqual([[1, null]]);
        expect(codeOf(outline)).toBe('01111');
        expect(itemsOf(outline)).toEqual([]);
    });

    it('closes only on the same character with at least the same length', () => {
        const outline = Outline.read(['````', '```', 'code', '````', '~~~', 'x', '~~~', 'after']);
        expect(outline.fences.map(fence => [fence.line, fence.close])).toEqual([[0, 3], [4, 6]]);
        expect(codeOf(outline)).toBe('11111110');
    });

    it('opens up to three columns past the content column, and not four', () => {
        expect(codeOf(Outline.read(['   ```', 'code', '   ```']))).toBe('111');
        // Four columns in at the top is indented code, not a fence.
        const indented = Outline.read(['    ```', '    code']);
        expect(indented.fences).toEqual([]);
        expect(codeOf(indented)).toBe('11');
    });

    it('closes up to three columns past the content column of its item, and not four', () => {
        const three = Outline.read(['- [ ] T', '  ```', '  x', '     ```', '  y']);
        expect(three.fences.map(fence => [fence.line, fence.close])).toEqual([[1, 3]]);
        expect(codeOf(three)).toBe('01110');
        // Four past, the delimiter is the code's content.
        const four = Outline.read(['- [ ] T', '  ```', '  x', '      ```', '  y']);
        expect(four.fences.map(fence => [fence.line, fence.close])).toEqual([[1, null]]);
        expect(codeOf(four)).toBe('01111');
    });

    it('rejects a backtick fence whose info string contains a backtick', () => {
        const outline = Outline.read(['``` a`b', 'prose']);
        expect(outline.fences).toEqual([]);
        expect(codeOf(outline)).toBe('00');
    });
});
