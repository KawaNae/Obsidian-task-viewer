import { describe, it, expect } from 'vitest';
import { writeBench, FILE, type WriteBench } from '../helpers/writeBench';
import { plannedOn } from '../../../src/services/persistence/TaskRefs';
import { keptLines } from '../../../src/services/persistence/ReplaceSubtree';
import { Outline } from '../../../src/services/parsing/utils/Outline';
import type { SubtreeLine } from '../../../src/services/persistence/TaskOps';
import { BrokenWrite, editLines, type MarkedLine } from '../../../src/services/persistence/FileLines';
import { Block } from '../../../src/services/persistence/utils/Placement';

/**
 * A row and its subtree written anew from a draft of their text (the hub's
 * source mode): which child lines the write keeps, rewritten where their
 * text changed, and which it writes anew, taken out and put where they
 * stand; and what the write's check refuses. Through the real writer and
 * `processLines`, so the report is the one the index is handed.
 */

/** A child line of a draft: its text, and the line of the subtree it was (null: new). */
type Child = [text: string, was: number | null];

/** Replace the subtree of the row on `line`, as the index's copy of it was read, with `text` and `children`. */
async function replace(b: WriteBench, line: number, text: string, children: Child[], base = b.taskAt(line).subtreeLines!) {
    const task = b.taskAt(line);
    const target = { ...plannedOn(task), basis: { text: base[0], subtree: base } };
    return b.writer.replaceSubtreeInFile(target, {
        text,
        children: children.map(([childText, was]): SubtreeLine => ({ text: childText, was })),
    }, { completes: () => false, fire: () => { throw new Error('no row completes here'); } });
}

/** The one write that landed: its report. */
function report(b: WriteBench) {
    expect(b.filed).toHaveLength(1);
    return b.filed[0].edits;
}

const P = '- [ ] P';
const A = '    - [ ] a';
const B = '    - [ ] b';

describe('a child line the draft kept', () => {
    it('is rewritten where its text changed, and the row with it', async () => {
        const b = await writeBench([P, A, B, '']);
        const made = await replace(b, 0, '- [ ] P2', [['    - [ ] a2', 1], [B, 2]]);

        expect(made.written).toBe(true);
        expect(b.lines()).toEqual(['- [ ] P2', '    - [ ] a2', B, '']);
        expect(report(b)).toEqual([{ kind: 'replaced', at: 0 }, { kind: 'replaced', at: 1 }]);
    });

    it('keeps the row\'s own indentation, whatever the draft\'s line has', async () => {
        const b = await writeBench(['- [ ] Q', '    - [ ] P', '        - [ ] a', '']);
        await replace(b, 1, '- [ ] P2', [['        - [ ] a', 1]]);

        expect(b.lines()).toEqual(['- [ ] Q', '    - [ ] P2', '        - [ ] a', '']);
        expect(report(b)).toEqual([{ kind: 'replaced', at: 1 }]);
    });

    it('stays where it is when a line is added above it or one taken out', async () => {
        const b = await writeBench([P, A, B, '']);
        await replace(b, 0, P, [['    - [ ] new', null], [B, 2]]);

        expect(b.lines()).toEqual([P, '    - [ ] new', B, '']);
        expect(report(b)).toEqual([
            { kind: 'replaced', at: 0 },
            { kind: 'removed', at: 1, count: 1 },
            { kind: 'inserted', at: 1, count: 1 },
        ]);
    });
});

describe('a child line the draft did not keep', () => {
    it('is new when the draft made it, and taken out when the draft left it out', async () => {
        const b = await writeBench([P, A, B, '- [ ] Q', '']);
        await replace(b, 0, P, [[A, 1], ['    - [ ] c', null]]);

        expect(b.lines()).toEqual([P, A, '    - [ ] c', '- [ ] Q', '']);
        expect(report(b)).toEqual([
            { kind: 'replaced', at: 0 },
            { kind: 'removed', at: 2, count: 1 },
            { kind: 'inserted', at: 2, count: 1 },
        ]);
    });

    it('is new when it went above a line kept before it: kept lines keep their order', async () => {
        const b = await writeBench([P, A, B, '']);
        await replace(b, 0, P, [[B, 2], [A, 1]]);

        expect(b.lines()).toEqual([P, B, A, '']);
        expect(report(b)).toEqual([
            { kind: 'replaced', at: 0 },
            { kind: 'removed', at: 1, count: 1 },
            { kind: 'inserted', at: 2, count: 1 },
        ]);
    });

    it('is new when it went under a sibling, and the write reads as the draft', async () => {
        const b = await writeBench([P, A, B, '']);
        const made = await replace(b, 0, P, [[A, 1], ['        - [ ] b', 2]]);

        expect(made.written).toBe(true);
        expect(b.lines()).toEqual([P, A, '        - [ ] b', '']);
        expect(report(b)).toEqual([
            { kind: 'replaced', at: 0 },
            { kind: 'removed', at: 2, count: 1 },
            { kind: 'inserted', at: 2, count: 1 },
        ]);
    });

    it('is new when it came up from under a line, and so is every line under it', async () => {
        const b = await writeBench([P, A, '        - [ ] b', '            - [ ] c', '']);
        const made = await replace(b, 0, P, [[A, 1], [B, 2], ['        - [ ] c', 3]]);

        expect(made.written).toBe(true);
        expect(b.lines()).toEqual([P, A, B, '        - [ ] c', '']);
        expect(report(b)).toEqual([
            { kind: 'replaced', at: 0 },
            { kind: 'removed', at: 2, count: 2 },
            { kind: 'inserted', at: 2, count: 2 },
        ]);
    });

    it('goes in a block of its own when it stands under a line the block before it does not hold', async () => {
        // `a1` under the kept `a`, then `c` under the row: one run of new
        // lines, two blocks, since a block's lines stand under its lines or
        // under the one line it was put under.
        const b = await writeBench([P, A, '']);
        const made = await replace(b, 0, P, [[A, 1], ['        - [ ] a1', null], ['    - [ ] c', null]]);

        expect(made.written).toBe(true);
        expect(b.lines()).toEqual([P, A, '        - [ ] a1', '    - [ ] c', '']);
        expect(report(b)).toEqual([
            { kind: 'replaced', at: 0 },
            { kind: 'inserted', at: 2, count: 1 },
            { kind: 'inserted', at: 3, count: 1 },
        ]);
    });

    it('is new when a new item above it takes it in: a line of the row\'s text that went on the new item\'s', async () => {
        const b = await writeBench(['- [ ] P', '  more of P', '']);
        const made = await replace(b, 0, P, [['  - [ ] n', null], ['  more of P', 1]]);

        expect(made.written).toBe(true);
        expect(b.lines()).toEqual(['- [ ] P', '  - [ ] n', '  more of P', '']);
        expect(report(b)).toEqual([
            { kind: 'replaced', at: 0 },
            { kind: 'removed', at: 1, count: 1 },
            { kind: 'inserted', at: 1, count: 2 },
        ]);
    });
});

describe('a draft that does not read as the row\'s subtree', () => {
    // `para` stands past the closed fence, outside the row: a fence left
    // open runs on over it.
    const FENCED = [P, '    ```', '    x', '    ```', 'para', ''];

    it('is refused as `disturbs` when it leaves a fence open over the lines below, and nothing is written', async () => {
        const b = await writeBench(FENCED);
        const made = await replace(b, 0, P, [['    ```', 1], ['    x', 2]]);

        expect(made.written).toBe(false);
        // The fence the note can be mended at: the kept line that opens it.
        expect(made.refused?.reason).toEqual({ kind: 'disturbs', fence: 1 });
        expect(b.lines()).toEqual(FENCED);
        expect(b.filed).toEqual([]);
    });

    it('names no fence when the fence left open is one the draft opened', async () => {
        const b = await writeBench(FENCED);
        const made = await replace(b, 0, P, [['    ```', null], ['    y', null]]);

        expect(made.refused?.reason).toEqual({ kind: 'disturbs', fence: null });
    });

    it('is written when the fence it leaves open ends at an item below, as the note reads', async () => {
        const b = await writeBench([P, A, '- [ ] Q', '']);
        const made = await replace(b, 0, P, [[A, 1], ['    ```', null]]);

        expect(made.written).toBe(true);
        expect(b.lines()).toEqual([P, A, '    ```', '- [ ] Q', '']);
    });

    it('is refused as `disturbs` when its text takes in the paragraph below the subtree', async () => {
        const note = [P, '    ```', '    code', '    ```', 'para', ''];
        const b = await writeBench(note);
        const made = await replace(b, 0, P, [['    text', null]]);

        expect(made.written).toBe(false);
        expect(made.refused?.reason).toEqual({ kind: 'disturbs', fence: null });
        expect(b.lines()).toEqual(note);
    });

    it('is refused as `unplaceable` when a child line stands outside the row', async () => {
        const note = [P, A, ''];
        const b = await writeBench(note);
        const made = await replace(b, 0, P, [[A, 1], ['- [ ] out', null]]);

        expect(made.written).toBe(false);
        expect(made.refused?.reason).toEqual({ kind: 'unplaceable', fence: null });
        expect(b.lines()).toEqual(note);
    });
});

describe('a subtree changed since the draft was opened on it', () => {
    it('is refused as `changed` when a child was added from outside', async () => {
        const b = await writeBench([P, A, '']);
        const base = b.taskAt(0).subtreeLines!;
        b.edit([P, A, B, '']);
        await b.scan();

        const made = await replace(b, 0, '- [ ] P2', [[A, 1]], base);

        expect(made.written).toBe(false);
        expect(made.refused?.reason).toEqual({ kind: 'changed' });
        expect(b.lines()).toEqual([P, A, B, '']);
    });

    it('is refused as `changed` when a property line was written into it', async () => {
        const b = await writeBench([P, A, '']);
        const base = b.taskAt(0).subtreeLines!;
        b.edit([P, '    - color:: red', A, '']);
        await b.scan();

        const made = await replace(b, 0, P, [[A, 1], [B, null]], base);

        expect(made.refused?.reason).toEqual({ kind: 'changed' });
    });
});

describe('a note\'s own marks', () => {
    it('keeps a CRLF note in CRLF, and its byte order mark', async () => {
        const b = await writeBench({ [FILE]: '﻿' + [P, A, ''].join('\r\n') });
        await replace(b, 0, '- [ ] P2', [[A, 1], [B, null]]);

        expect(b.text()).toBe('﻿' + ['- [ ] P2', A, B, ''].join('\r\n'));
    });
});

describe('keptLines', () => {
    const read = (lines: string[]) => Outline.read(lines);

    it('keeps a line whose kind and item stand, and not one of another kind', () => {
        const before = read([P, A, '    text', '']);
        const after = read([P, A, '    ```', '']);
        expect([...keptLines(before, after, 0, 3, [1, 2])]).toEqual([[1, 1]]);
    });

    it('keeps no line named twice, nor one named above a line kept', () => {
        const before = read([P, A, B, '']);
        const after = read([P, A, A, B, '']);
        expect([...keptLines(before, after, 0, 3, [1, 1, 2])]).toEqual([[1, 1], [3, 2]]);
    });
});

describe('a line a write marked (`WriteSession.mark`)', () => {
    it('is found where the write\'s own edits after the mark carried it, and gone once one took it away', () => {
        const found: Array<number | null> = [];
        const edited = editLines(FILE, ['a', 'b', 'c'], '\n', (draft, _eol, session) => {
            draft.rewrite(1, 'B');
            const b = session.mark(1);
            const c = session.mark(2);
            draft.put({ at: 0, parent: null, indent: '' }, Block.line('top'));
            found.push(session.row(b));
            draft.splice(3, 1);
            found.push(session.row(b), session.row(c));
            return found.every(line => line !== null);
        });

        expect(found).toEqual([2, 2, null]);
        // Asked for a line taken away, the write is refused as a row is.
        expect(edited).toEqual({ written: false, refused: { file: FILE, reason: { kind: 'gone' }, subject: 'c' } });
    });

    it('is a line of the write that marked it only', () => {
        let other: MarkedLine | null = null;
        editLines(FILE, ['a'], '\n', (_draft, _eol, session) => { other = session.mark(0); return true; });

        expect(() => editLines(FILE, ['a'], '\n', (_draft, _eol, session) => session.row(other!) !== null)).toThrow(BrokenWrite);
    });
});

describe('a draft that names a line no subtree has', () => {
    it('is a caller\'s bug, which a development build throws', async () => {
        const b = await writeBench([P, A, '']);
        await expect(replace(b, 0, P, [[A, 5]])).rejects.toThrow(BrokenWrite);
    });
});
