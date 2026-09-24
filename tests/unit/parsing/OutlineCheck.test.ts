import { describe, it, expect } from 'vitest';
import { Outline, type WrittenLine, type WriteCheck } from '../../../src/services/parsing/utils/Outline';
import { ChildLineClassifier } from '../../../src/services/parsing/utils/ChildLineClassifier';
import { draftOver, replayEdits, type LineDraft } from '../../../src/utils/FileLines';
import { Block, Placement, type Spot } from '../../../src/services/persistence/utils/Placement';

/**
 * The one check every write is held to (`Outline.check`, run by
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
    return Outline.check(Outline.read(before), Outline.read(after), written, puts, line => ChildLineClassifier.carriesMeaning(line));
}

/** One line put at `spot`, to read as it does by itself. */
const putLine = (spot: Spot, text: string) => (draft: LineDraft) => draft.put(spot, Block.line(spot.indent + text));

describe('a line put in reads as its block says, or the write is unplaceable', () => {
    it('is sound where the line is a task under the item meant', () => {
        const lines = ['- [ ] T', '  - [ ] a', '- [ ] U'];
        expect(checked(lines, putLine(Placement.lastChild(lines, 0), '- [ ] c'))).toBe('sound');
        expect(checked(lines, putLine(Placement.firstChild(lines, 0), '- [ ] c'))).toBe('sound');
        expect(checked(lines, putLine(Placement.afterSubtree(lines, 0), '- [ ] c'))).toBe('sound');
        expect(checked(lines, putLine(Placement.end(lines), '- [ ] c'))).toBe('sound');
    });

    it('is unplaceable where the line goes on the item\'s own fence that never closes (R5)', () => {
        const lines = ['- [ ] T', '    ```', '    code', '- [ ] U', ''];
        expect(checked(lines, putLine(Placement.lastChild(lines, 0), '- [ ] c'))).toBe('unplaceable');
        // A sibling put there starts an item, which ends the fence.
        expect(checked(lines, putLine(Placement.afterSubtree(lines, 0), '- [ ] c'))).toBe('sound');
    });

    it('is unplaceable at the end of a note whose fence at the top never closes, and inside a closed one', () => {
        const open = ['text', '```', 'code', ''];
        expect(checked(open, putLine(Placement.end(open), '- [ ] n'))).toBe('unplaceable');
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
        expect(checked(lines, (draft) => draft.put(Placement.afterSubtree(lines, 0), Block.of(reading, [0, 1], ['- [ ] T', '  - [ ] c'])))).toBe('sound');
        expect(checked(lines, (draft) => draft.put(Placement.afterSubtree(lines, 0), Block.of(reading, [0, 1], ['- [ ] T', '  c'])))).toBe('unplaceable');
    });

    it('holds a carried line to the reading it had, its lost parent included', () => {
        // T's `==>` line is not carried; the task under it has lost its item.
        const lines = ['- [ ] T', '  - ==> every mon', '    - [ ] sub', ''];
        const reading = Outline.read(lines);
        const block = Block.of(reading, [0, 2], ['- [x] T', '  - [ ] sub'], true);
        expect(block.map(line => line.under)).toEqual(['spot', 'lost']);
        expect(checked(lines, (draft) => {
            draft.put(Placement.end(lines), block);
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
        expect(checked(lines, putLine(Placement.firstChild(lines, 0), '- [ ] c'))).toBe('sound');
    });

    it('disturbs where a heading\'s paragraph would go on the new item', () => {
        const lines = ['## H', 'words', '- [ ] a'];
        expect(checked(lines, putLine({ at: 1, parent: null, indent: '' }, '- [ ] n'))).toBe('disturbs');
        expect(checked(lines, putLine(Placement.underHeading(lines, 0), '- [ ] n'))).toBe('sound');
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
        expect(checked(lines, putLine(Placement.lastChild(lines, 2), '- [ ] c'))).toBe('sound');
        expect(checked(lines, putLine(Placement.afterSubtree(lines, 2), '- [ ] c'))).toBe('sound');
        expect(checked(lines, putLine(Placement.firstChild(lines, 2), '- [ ] c'))).toBe('sound');
    });
});
