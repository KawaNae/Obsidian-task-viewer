import { describe, it, expect } from 'vitest';
import { SubtreeFrame, type DraftCheck } from '../../../src/services/persistence/utils/SubtreeFrame';
import type { SubtreeLine } from '../../../src/services/persistence/TaskOps';

/**
 * The hub's source editor and the file (`SubtreeFrame`): a row and its
 * subtree shown with the row's indentation and the child indentation taken
 * off, and a draft written back, every line kept as it opened byte for byte.
 */

function opened(base: string[], unit = '\t'): SubtreeFrame {
    const opening = SubtreeFrame.open(base, unit);
    if (!opening.open) throw new Error(`shut at line ${opening.line}`);
    return opening.frame;
}

/** The draft the editor holds when nothing was changed: each line where it opened. */
function untouched(frame: SubtreeFrame): SubtreeLine[] {
    return frame.children.map((text, i) => ({ text, was: i + 1 }));
}

function written(check: DraftCheck): string[] {
    if (check.kind !== 'write') throw new Error(`not written: ${JSON.stringify(check)}`);
    return [check.replacement.text, ...check.replacement.children.map(child => child.text)];
}

const SUBTREES: Array<[name: string, base: string[]]> = [
    ['tabs', ['- [ ] T', '\t- [ ] a', '\t\t- [ ] b', '\t- k:: v']],
    ['two spaces', ['- [ ] T', '  - [ ] a', '    - [ ] b']],
    ['four spaces', ['- [ ] T', '    - [ ] a', '        - [ ] b']],
    ['a tab under two spaces, which reaches four', ['- [ ] T', '  - [ ] a', '  \t- [ ] b']],
    ['an ordered row', ['10. [ ] T', '    - [ ] a', '        text']],
    ['a command and a code block', ['- [ ] T', '    - ==> every mon', '    ```js', '    let a = 1;', '', '    ```', '    - [ ] c']],
    ['blank lines holding spaces', ['- [ ] T', '    - [ ] a', '   ', '    - [ ] b']],
    ['a row indented with tabs', ['\t\t- [ ] T', '\t\t\t- [ ] a']],
    ['a row indented four columns and more, read alone as code', ['        - [ ] T', '            - [ ] a', '                - [ ] b']],
    ['a row at an odd column', ['   - [ ] T', '     - [ ] a']],
    ['no children', ['- [ ] T']],
];

describe('SubtreeFrame: opening a subtree', () => {
    it('shows the row without its indentation, and each child without the child indentation', () => {
        const frame = opened(['\t- [ ] T', '\t\t- [ ] a', '\t\t\t- [ ] b', '\t\t  more']);
        expect(frame.parent).toBe('- [ ] T');
        expect(frame.childIndent).toBe('\t\t');
        expect(frame.children).toEqual(['- [ ] a', '\t- [ ] b', '  more']);
    });

    it('shows a line whose indentation does not start with the child indentation at its columns, in spaces', () => {
        // `  \t` reaches column 4, two past the child indentation; the tab alone would reach four.
        expect(opened(['- [ ] T', '  - [ ] a', '  \t- [ ] b']).children).toEqual(['- [ ] a', '  - [ ] b']);
    });

    it('shows a blank line empty', () => {
        expect(opened(['- [ ] T', '    - [ ] a', '   ', '    - [ ] b']).children).toEqual(['- [ ] a', '', '- [ ] b']);
    });

    it('takes the child indentation from the first child, or the new level of the settings when there is none', () => {
        expect(opened(['- [ ] T', '  - [ ] a'], '\t').childIndent).toBe('  ');
        expect(opened(['- [ ] T'], '\t').childIndent).toBe('\t');
        expect(opened(['- [ ] T'], '    ').childIndent).toBe('    ');
        expect(opened(['10. [ ] T'], '  ').childIndent).toBe('    ');
        expect(opened(['        - [ ] T'], '\t').childIndent).toBe('        \t');
    });

    it('is shut on a line shallower than a child: the row\'s text going on at its content, above deeper children', () => {
        expect(SubtreeFrame.open(['- [ ] T', '  going on', '    - [ ] c'], '\t')).toEqual({ open: false, reason: 'shallow', line: 1 });
    });

    it('is shut on a lazy line', () => {
        expect(SubtreeFrame.open(['- [ ] T', 'lazy', '    - [ ] c'], '\t')).toEqual({ open: false, reason: 'shallow', line: 1 });
    });

    it('opens on the row\'s text going on at the child indentation', () => {
        expect(opened(['- [ ] T', '    going on', '    - [ ] c']).children).toEqual(['going on', '- [ ] c']);
    });
});

describe('SubtreeFrame: a draft back to the file\'s lines', () => {
    describe.each(SUBTREES)('%s', (_name, base) => {
        it('is the subtree opened, byte for byte, when nothing is changed', () => {
            const frame = opened(base);
            expect(frame.check({ parent: frame.parent, children: untouched(frame) })).toEqual({ kind: 'same' });
        });

        it('keeps every child line byte for byte when only the row\'s text changes', () => {
            const frame = opened(base);
            const lines = written(frame.check({ parent: frame.parent + ' more', children: untouched(frame) }));
            expect(lines).toEqual([base[0] + ' more', ...base.slice(1)]);
        });
    });

    it('keeps the characters of a line\'s indentation when only its text changed', () => {
        const frame = opened(['- [ ] T', '  - [ ] a', '  \t- [ ] b']);
        const children = untouched(frame);
        children[1] = { text: '  - [ ] b2', was: 2 };
        expect(written(frame.check({ parent: frame.parent, children }))).toEqual(['- [ ] T', '  - [ ] a', '  \t- [ ] b2']);
    });

    it('spells a line the editor made, or re-indented, as the child indentation and the editor\'s', () => {
        const frame = opened(['\t- [ ] T', '\t\t- [ ] a', '\t\t\t- [ ] b'], '    ');
        const lines = written(frame.check({
            parent: frame.parent,
            children: [
                { text: '- [ ] a', was: 1 },
                { text: '- [ ] b', was: 2 },   // un-indented a level
                { text: '\t- [ ] new', was: null },
            ],
        }));
        expect(lines).toEqual(['\t- [ ] T', '\t\t- [ ] a', '\t\t- [ ] b', '\t\t\t- [ ] new']);
    });

    it('spells a new line under a row with no children at the settings\' new level', () => {
        const frame = opened(['- [ ] T'], '    ');
        expect(frame.children).toEqual([]);
        const lines = written(frame.check({ parent: frame.parent, children: [{ text: '- [ ] c', was: null }] }));
        expect(lines).toEqual(['- [ ] T', '    - [ ] c']);
    });

    it('keeps the columns where the editor\'s tab would reach another past the child indentation', () => {
        // Past two columns a tab reaches four, two columns deeper, not four.
        const frame = opened(['- [ ] T', '  - [ ] a']);
        const lines = written(frame.check({ parent: frame.parent, children: [{ text: '- [ ] a', was: 1 }, { text: '\t- [ ] b', was: null }] }));
        expect(lines).toEqual(['- [ ] T', '  - [ ] a', '      - [ ] b']);
    });

    it('writes the children at a child\'s column when the row opens its content further in', () => {
        // `10. ` opens its content at column 4: two spaces are a sibling there.
        const frame = opened(['- [ ] T', '  - [ ] a', '    - [ ] b', '  text']);
        const lines = written(frame.check({ parent: '10. [ ] T', children: untouched(frame) }));
        expect(lines).toEqual(['10. [ ] T', '\t- [ ] a', '\t  - [ ] b', '\ttext']);
    });

    it('keeps the child indentation when the row\'s new content column still takes it', () => {
        const frame = opened(['- [ ] T', '    - [ ] a']);
        expect(written(frame.check({ parent: '1. [ ] T', children: untouched(frame) }))).toEqual(['1. [ ] T', '    - [ ] a']);
    });

    it('drops the blank lines that end the child editor', () => {
        const frame = opened(['- [ ] T', '    - [ ] a']);
        const check = frame.check({ parent: frame.parent, children: [...untouched(frame), { text: '', was: null }, { text: '  ', was: null }] });
        expect(check).toEqual({ kind: 'same' });
        expect(written(frame.check({ parent: frame.parent, children: [{ text: '', was: null }, { text: '- [ ] a', was: 1 }, { text: '', was: null }] })))
            .toEqual(['- [ ] T', '', '    - [ ] a']);
    });

    it('writes a line typed on a blank line as a new one', () => {
        const frame = opened(['- [ ] T', '    - [ ] a', '   ', '    - [ ] b']);
        const children = untouched(frame);
        children[1] = { text: 'note', was: 2 };
        expect(written(frame.check({ parent: frame.parent, children }))).toEqual(['- [ ] T', '    - [ ] a', '    note', '    - [ ] b']);
    });

    it('answers the lines each child was', () => {
        const frame = opened(['- [ ] T', '    - [ ] a', '    - [ ] b']);
        const check = frame.check({ parent: frame.parent, children: [{ text: '- [ ] b', was: 2 }, { text: '- [ ] a', was: null }] });
        expect(check).toEqual({
            kind: 'write',
            replacement: { text: '- [ ] T', children: [{ text: '    - [ ] b', was: 2 }, { text: '    - [ ] a', was: null }] },
        });
    });

    it('is the same when the lines are the ones opened, whichever lines the editor says they were', () => {
        const frame = opened(['- [ ] T', '    - [ ] a']);
        expect(frame.check({ parent: frame.parent, children: [{ text: '- [ ] a', was: null }] })).toEqual({ kind: 'same' });
    });

    it('refuses a row\'s editor of two lines', () => {
        const frame = opened(['- [ ] T']);
        expect(frame.check({ parent: '- [ ] T\n- [ ] U', children: [] })).toEqual({ kind: 'refused', reason: 'parent-break' });
    });

    it('refuses a row that is no task line', () => {
        const frame = opened(['- [ ] T']);
        expect(frame.check({ parent: '', children: [] })).toEqual({ kind: 'refused', reason: 'not-task' });
        expect(frame.check({ parent: '- T', children: [] })).toEqual({ kind: 'refused', reason: 'not-task' });
    });

    it('takes the row\'s indentation off what the row\'s editor holds, the file\'s being the row\'s', () => {
        const frame = opened(['\t- [ ] T']);
        expect(written(frame.check({ parent: '  - [ ] T2', children: [] }))).toEqual(['\t- [ ] T2']);
    });

    it('throws on a line a child was that is no child line of the subtree: a caller\'s bug', () => {
        const frame = opened(['- [ ] T', '    - [ ] a']);
        expect(() => frame.check({ parent: frame.parent, children: [{ text: 'x', was: 0 }] })).toThrow(RangeError);
        expect(() => frame.check({ parent: frame.parent, children: [{ text: 'x', was: 2 }] })).toThrow(RangeError);
    });
});
