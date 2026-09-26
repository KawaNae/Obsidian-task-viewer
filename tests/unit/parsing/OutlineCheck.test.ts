import { describe, it, expect } from 'vitest';
import { Outline } from '../../../src/services/parsing/utils/Outline';
import { checkWrite, type WrittenLine, type WriteCheck } from '../../../src/services/parsing/utils/OutlineCheck';
import { draftOver, replayEdits, type LineDraft } from '../../../src/utils/FileLines';
import { Block, Placement, type Spot } from '../../../src/services/persistence/utils/Placement';
import { renderFlowInstance } from '../../../src/services/persistence/FlowInstanceLines';
import { FileOperations } from '../../../src/services/persistence/utils/FileOperations';
import type { App } from 'obsidian';

/**
 * The one check every write is held to (`checkWrite`, run by
 * `processLines`), rule by rule: a line kept keeps its kind and, for an item
 * with a meaning, the items above it; a line put in reads as its block says;
 * an item put in takes in no line past its block; a line spliced into the
 * body without a block is a bug.
 */

/** What the check says of `edit` made to `lines`, through the same draft `processLines` hands a write. */
function checked(lines: string[], edit: (draft: LineDraft) => void): WriteCheck {
    const before = [...lines];
    const after = [...lines];
    const { draft, reported, puts, placedBy } = draftOver(after);
    edit(draft);
    const replayed = replayEdits(before.length, reported, placedBy)!;
    const written = replayed.origin.map((from, k): WrittenLine => {
        const put = replayed.placed[k];
        if (put) return { kind: 'placed', put: put.id, offset: put.offset };
        return from === null ? { kind: 'loose' } : { kind: 'kept', from };
    });
    return checkWrite(Outline.read(before), Outline.read(after), written, puts);
}

/** One line put at `spot`, to read as it does by itself. */
const putLine = (spot: Spot, text: string) => (draft: LineDraft) => draft.put(spot, Block.line(spot.indent + text));

describe('a line put in reads as its block says, or the write is unplaceable', () => {
    it('is sound where the line is a task under the item meant', () => {
        const lines = ['- [ ] T', '  - [ ] a', '- [ ] U'];
        expect(checked(lines, putLine(Placement.lastChild(Outline.read(lines), 0, '- [ ] n'), '- [ ] c'))).toBe('sound');
        expect(checked(lines, putLine(Placement.firstChild(Outline.read(lines), 0, '- [ ] n'), '- [ ] c'))).toBe('sound');
        expect(checked(lines, putLine(Placement.afterSubtree(Outline.read(lines), 0, '- [ ] n'), '- [ ] c'))).toBe('sound');
        expect(checked(lines, putLine(Placement.end(Outline.read(lines)), '- [ ] c'))).toBe('sound');
    });

    it('is unplaceable where the line goes on the item\'s own fence that never closes (R5)', () => {
        const lines = ['- [ ] T', '    ```', '    code', '- [ ] U', ''];
        // Past the fence, the line goes on it.
        expect(checked(lines, putLine({ at: 3, parent: 0, indent: '    ' }, '- [ ] c'))).toBe('unplaceable');
        // A last child goes at the end of the children, above the fence (R5 closed).
        expect(Placement.lastChild(Outline.read(lines), 0, '- [ ] n').at).toBe(1);
        expect(checked(lines, putLine(Placement.lastChild(Outline.read(lines), 0, '- [ ] n'), '- [ ] c'))).toBe('sound');
        // A sibling put there starts an item, which ends the fence.
        expect(checked(lines, putLine(Placement.afterSubtree(Outline.read(lines), 0, '- [ ] n'), '- [ ] c'))).toBe('sound');
    });

    it('is unplaceable at the end of a note whose fence at the top never closes, and inside a closed one', () => {
        const open = ['text', '```', 'code', ''];
        expect(checked(open, putLine(Placement.end(Outline.read(open)), '- [ ] n'))).toBe('unplaceable');
        const closed = ['text', '```', 'code', '```', '', 'text'];
        expect(checked(closed, putLine({ at: 2, parent: null, indent: '' }, '- [ ] n'))).toBe('unplaceable');
        expect(checked(closed, putLine({ at: 4, parent: null, indent: '' }, '- [ ] n'))).toBe('sound');
    });

    it('is unplaceable in the frontmatter', () => {
        const lines = ['---', 'a: 1', '---', '', 'body'];
        expect(checked(lines, putLine({ at: 1, parent: null, indent: '' }, '- [ ] n'))).toBe('unplaceable');
        expect(checked(lines, putLine({ at: 3, parent: null, indent: '' }, '- [ ] n'))).toBe('sound');
    });

    it('is unplaceable where the line is a task under another item than the one meant', () => {
        // Meant as P's child, written at the top: a sibling of P.
        const lines = ['- [ ] P', '  - [ ] a'];
        expect(checked(lines, (draft) => draft.put({ at: 2, parent: 0, indent: '' }, Block.line('- [ ] c')))).toBe('unplaceable');
        // Meant as a sibling of a, one column short of P's content: P's sibling.
        expect(checked(lines, (draft) => draft.put({ at: 2, parent: 0, indent: ' ' }, Block.line(' - [ ] c')))).toBe('unplaceable');
    });

    it('is unplaceable where a line of a copy reads otherwise than the line it copies', () => {
        // The copy's child is written as text: no item where the original's is.
        const lines = ['- [ ] T', '  - [ ] c', '- [ ] U'];
        const reading = Outline.read(lines);
        expect(checked(lines, (draft) => draft.put(Placement.afterSubtree(Outline.read(lines), 0, '- [ ] n'), Block.of(reading, [0, 1], ['- [ ] T', '  - [ ] c'])))).toBe('sound');
        expect(checked(lines, (draft) => draft.put(Placement.afterSubtree(Outline.read(lines), 0, '- [ ] n'), Block.of(reading, [0, 1], ['- [ ] T', '  c'])))).toBe('unplaceable');
    });

    it('lets a note bullet that lost its item go where it lands: it is no task, command or property', () => {
        // The mutation run's 1h: the parent of a put item is asked only of
        // one the plugin reads a meaning from.
        const lines = ['- [ ] T', '  - ==> every mon', '    - note', ''];
        const reading = Outline.read(lines);
        const block = Block.of(reading, [0, 2], ['- [x] T', '    - note'], true);
        expect(block.map(line => line.under)).toEqual(['spot', 'lost']);
        expect(checked(lines, (draft) => {
            draft.put(Placement.end(Outline.read(lines)), block);
            draft.splice(0, 3);
        })).toBe('sound');
    });

    it('holds a carried line to the reading it had, its lost parent included', () => {
        // T's `==>` line is not carried; the task under it has lost its item.
        const lines = ['- [ ] T', '  - ==> every mon', '    - [ ] sub', ''];
        const reading = Outline.read(lines);
        const block = Block.of(reading, [0, 2], ['- [x] T', '  - [ ] sub'], true);
        expect(block.map(line => line.under)).toEqual(['spot', 'lost']);
        expect(checked(lines, (draft) => {
            draft.put(Placement.end(Outline.read(lines)), block);
            draft.splice(0, 3);
        })).toBe('unplaceable');
    });
});

describe('a line kept keeps its kind, and a task its items above, or the write disturbs', () => {
    it('disturbs where a child of a line taken out would stand elsewhere, or be no task', () => {
        const lines = ['- [ ] T', '\t- memo:: a', '\t\t- [ ] sub', '- [ ] U'];
        expect(checked(lines, (draft) => draft.splice(1, 1))).toBe('disturbs');
        // Taken with it, nothing is left to stand elsewhere.
        expect(checked(lines, (draft) => draft.splice(1, 2))).toBe('sound');
    });

    it('disturbs where a task below a subtree taken out would go under the item above (the probe\'s B)', () => {
        const lines = ['- [x] a', ' - [ ] t', '  1. [ ] u'];
        expect(checked(lines, (draft) => draft.splice(1, 1))).toBe('disturbs');
    });

    it('disturbs where a line put in makes a task below its child (counterexample 5)', () => {
        const lines = ['- [ ] T', '  - [ ] c', '- [ ] U'];
        expect(checked(lines, putLine({ at: 1, parent: null, indent: '' }, '- [ ] T'))).toBe('disturbs');
    });

    it('disturbs where a line put in ends a fence below it, or opens one', () => {
        const lines = ['- [ ] T', '  ```', '  x', '  ```', 'after'];
        // A fence opener put in as text makes the rest code.
        expect(checked(lines, (draft) => draft.put({ at: 4, parent: null, indent: '' }, Block.read(['```'])))).toBe('disturbs');
    });

    it('leaves a blank line blank wherever it stands: taking a fence\'s blank line out of it disturbs nothing (q13)', () => {
        const lines = ['- [ ] T', '  ```', '  x', '', '- [ ] U'];
        expect(Outline.read(lines).fences[0].end).toBe(4);
        expect(Outline.read(lines).kindOf(3)).toBe('blank');
        expect(checked(lines, (draft) => draft.splice(2, 1))).toBe('sound');
    });

    it('lets a note bullet or a paragraph line go on another item', () => {
        expect(checked(['- [ ] T', '  - ==> every mon', '    - why'], (draft) => draft.splice(1, 1))).toBe('sound');
    });
});

describe('an item put in takes in no line past its block, or the write disturbs', () => {
    it('disturbs where a paragraph line below would go on the new item', () => {
        const lines = ['- [ ] T', 'lazy', '- [ ] U'];
        expect(checked(lines, putLine({ at: 1, parent: 0, indent: '\t' }, '- [ ] c'))).toBe('disturbs');
        // Past the lazy line, nothing goes on it.
        expect(checked(lines, putLine(Placement.firstChild(Outline.read(lines), 0, '- [ ] n'), '- [ ] c'))).toBe('sound');
    });

    it('disturbs where a heading\'s paragraph would go on the new item', () => {
        const lines = ['## H', 'words', '- [ ] a'];
        expect(checked(lines, putLine({ at: 1, parent: null, indent: '' }, '- [ ] n'))).toBe('disturbs');
        expect(checked(lines, putLine(Placement.underHeading(Outline.read(lines), 0, '- [ ] n'), '- [ ] n'))).toBe('sound');
    });
});

describe('a line spliced into the body without a block', () => {
    it('is a bug in the write, and one in the frontmatter is not', () => {
        expect(checked(['- [ ] a'], (draft) => draft.splice(1, 0, '- [ ] b'))).toBe('loose');
        expect(checked(['---', 'a: 1', '---', 'body'], (draft) => draft.splice(2, 0, 'b: 2'))).toBe('sound');
        expect(checked(['body'], (draft) => draft.splice(0, 0, '---', 'b: 2', '---'))).toBe('sound');
    });
});

describe('mixed indentation', () => {
    it('is sound where a child is put under a tab row among space-indented siblings', () => {
        const lines = ['- [ ] P', '    - [ ] a', '\t- [ ] T', '    - [ ] b'];
        expect(checked(lines, putLine(Placement.lastChild(Outline.read(lines), 2, '- [ ] n'), '- [ ] c'))).toBe('sound');
        expect(checked(lines, putLine(Placement.afterSubtree(Outline.read(lines), 2, '- [ ] n'), '- [ ] c'))).toBe('sound');
        expect(checked(lines, putLine(Placement.firstChild(Outline.read(lines), 2, '- [ ] n'), '- [ ] c'))).toBe('sound');
    });
});

describe('a line placed past what it would take in, as the reading with it in says (`Placement.settle`)', () => {
    /** The spot and the check, for `text` put where `where` answers. */
    const put = (lines: string[], where: (text: string) => Spot, text: string) => {
        const spot = where(text);
        return { spot, check: checked(lines, (draft) => draft.put(spot, Block.line(text))) };
    };

    it('goes past a closed fence under a heading that a line put above would take in (the second run\'s H1)', () => {
        const lines = ['## H', '  ```', '  x', '  ```', '- [ ] A'];
        expect(put(lines, text => Placement.underHeading(Outline.read(lines), 0, text), '- [ ] n'))
            .toEqual({ spot: { at: 4, parent: null, indent: '' }, check: 'sound' });
    });

    it('goes past a task\'s closed fence past the new child\'s content column (H2, H3)', () => {
        const lines = ['1. [ ] T', '      ```', '      x', '      ```', '   - [ ] c'];
        expect(put(lines, text => Placement.firstChild(Outline.read(lines), 0, text), '- [ ] n'))
            .toEqual({ spot: { at: 4, parent: 0, indent: '   ' }, check: 'sound' });
        expect(put(lines, text => Placement.firstChild(Outline.read(lines), 0, text), '- zz:: 1'))
            .toEqual({ spot: { at: 4, parent: 0, indent: '   ' }, check: 'sound' });
    });

    it('goes past a paragraph a copy would take in below the task\'s closed fence (D1)', () => {
        const lines = ['- [ ] T', '  ```', '  x', '  ```', 'para', ''];
        expect(put(lines, text => Placement.copyOf(Outline.read(lines), 0, 'below', text), '- [ ] T'))
            .toEqual({ spot: { at: 5, parent: null, indent: '' }, check: 'sound' });
    });

    it('stops at an item of the note it would take in, and takes that item\'s indentation', () => {
        const lines = ['## H', 'text', '  - [ ] a'];
        expect(put(lines, text => Placement.underHeading(Outline.read(lines), 0, text), '- [ ] n'))
            .toEqual({ spot: { at: 2, parent: null, indent: '  ' }, check: 'sound' });
    });

    it('asks of the line as it is written: a wider marker opens its content further in', () => {
        // `more` is T's indented code: past a tab and `- ` it would go on
        // the line as a paragraph of its own; past a tab and `10. `, not.
        const lines = ['- [ ] T', '', '	  more', '- [ ] U'];
        expect(put(lines, text => Placement.firstChild(Outline.read(lines), 0, text), '- [ ] n').spot.at).toBe(3);
        expect(put(lines, text => Placement.firstChild(Outline.read(lines), 0, text), '10. [ ] n').spot.at).toBe(1);
    });

    it('takes for a new line the indentation of the sibling it goes above: a sibling of `1.` over a `- ` at two (the first run\'s B)', () => {
        const lines = ['1. [ ] T', '  - [ ] U'];
        expect(put(lines, text => Placement.afterSubtree(Outline.read(lines), 0, text), '- [x] n'))
            .toEqual({ spot: { at: 1, parent: null, indent: '  ' }, check: 'sound' });
        // A copy of T is spelled as T, and reads as T does: U, not T's, stays where it stands.
        expect(put(lines, text => Placement.copyOf(Outline.read(lines), 0, 'below', text), '1. [ ] T'))
            .toEqual({ spot: { at: 1, parent: null, indent: '' }, check: 'sound' });
    });
});

describe('a next instance put at a sibling spelled apart from the row that fired', () => {
    it('is written at the sibling\'s indentation, its `==>` line as far past it as it stands past the row', () => {
        // R is four spaces in, its group's head A a tab: both P's children.
        const lines = ['- [ ] P', '\t- [x] A', '    - [ ] R ==> every mon', '      - ==> every mon', ''];
        const block = renderFlowInstance(new FileOperations({} as App), lines, 2, { kind: 'recurrence', content: '- [ ] R', flowLines: ['every mon'] });
        const spot = Placement.groupHead(Outline.read(lines), 2, '- [ ] R');
        expect(spot).toEqual({ at: 1, parent: 0, indent: '\t' });
        const check = checked(lines, (draft) => draft.put(spot, block));
        expect(check).toBe('sound');
        const written = [...lines];
        draftOver(written).draft.put(spot, block);
        expect(written.slice(1, 3)).toEqual(['	- [ ] R', '	  - ==> every mon']);
    });
});

describe('a copy written at the spelling of the row it copies (the third run\'s a)', () => {
    it('keeps the copied child a child where the sibling below is spelled apart', () => {
        const lines = ['-\t[ ] T', '\t- [ ] c', '   - [ ] U'];
        const reading = Outline.read(lines);
        const spot = Placement.copyOf(Outline.read(lines), 0, 'below', lines[0]);
        // A new line there is spelled as U, and takes the copied child in.
        expect(Placement.afterSubtree(Outline.read(lines), 0, lines[0])).toEqual({ at: 2, parent: null, indent: '   ' });
        expect(spot).toEqual({ at: 2, parent: null, indent: '' });
        expect(checked(lines, (draft) => draft.put(spot, Block.of(reading, [0, 1], [lines[0], lines[1]])))).toBe('sound');
    });
});
