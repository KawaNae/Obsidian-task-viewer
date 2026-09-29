import { describe, it, expect } from 'vitest';
import { indentLess } from '@codemirror/commands';
import { indentUnit } from '@codemirror/language';
import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state';
import {
    breakParent, indentMoreRestartingLists, listMarkup, listNumbering, moveLineDownKeepingNumbers,
    moveLineUpKeepingNumbers, newlineContinuingList, outdented,
} from '../../../../src/modals/form/source/ListMarkup';
import { childrenState, draftOf, parentState } from '../../../../src/modals/form/source/SourceEditor';

/**
 * Lists in the source editor. The expected texts are what Obsidian 1.13.7's
 * own editor made of the same text and keys in the Dev vault (tabs, 4
 * columns), measured on 2026-09-29 (source-mode-design.md, 段 4b).
 */

/** `text` with the caret at '|', in an editor that numbers its lists. */
function stateWith(text: string, unit = '\t'): EditorState {
    const at = text.indexOf('|');
    return EditorState.create({
        doc: text.replace('|', ''),
        selection: EditorSelection.cursor(at),
        extensions: [listNumbering, indentUnit.of(unit), EditorState.tabSize.of(4)],
    });
}

function shown(state: EditorState): string {
    const at = state.selection.main.head;
    const doc = state.doc.toString();
    return doc.slice(0, at) + '|' + doc.slice(at);
}

function run(state: EditorState, command: StateCommand): EditorState {
    let next = state;
    command({ state, dispatch: (tr) => { next = tr.state; } });
    return next;
}

function type(state: EditorState, text: string): EditorState {
    return state.update(state.replaceSelection(text), { userEvent: 'input.type' }).state;
}

describe('listMarkup', () => {
    it('reads bullets, numbers and checkboxes of any status, each needing the whitespace after it', () => {
        expect(listMarkup('\t- [x] a')).toMatchObject({ indent: '\t', bullet: '-', number: null, checkbox: true, end: 7, markerEnd: 2 });
        expect(listMarkup('12) b')).toMatchObject({ indent: '', bullet: null, number: 12, delimiter: ')', checkbox: false, end: 4, markerEnd: 3 });
        expect(listMarkup('- [/] c')?.checkbox).toBe(true);
        expect(listMarkup('- [ ]')?.checkbox).toBe(false);
        expect(listMarkup('-')).toBeNull();
        expect(listMarkup('2.')).toBeNull();
        expect(listMarkup('---')).toBeNull();
        expect(listMarkup('text')).toBeNull();
    });

    it('gives up a level of indent as Obsidian does: the last tab, or up to a tab\'s width of trailing spaces', () => {
        expect(outdented('\t\t', 4)).toBe('\t');
        expect(outdented('\t  ', 4)).toBe('\t');
        expect(outdented('      ', 4)).toBe('  ');
        expect(outdented('        ', 4)).toBe('    ');
        expect(outdented('  ', 4)).toBe('');
    });
});

describe('Enter in the children\'s editor, as Obsidian\'s editor', () => {
    const cases: [string, string][] = [
        // Going on with a list
        ['- [ ] a|', '- [ ] a\n- [ ] |'],
        ['- [x] a|', '- [x] a\n- [ ] |'],
        ['- [/] a|', '- [/] a\n- [ ] |'],
        ['- [-] a|', '- [-] a\n- [ ] |'],
        ['- a|', '- a\n- |'],
        ['* a|', '* a\n* |'],
        ['* [x] a|', '* [x] a\n* [ ] |'],
        ['+ [ ] a|', '+ [ ] a\n+ [ ] |'],
        ['- [ ] a|b', '- [ ] a\n- [ ] |b'],
        // Obsidian drops the trailing space too; it stays, to keep the line the row it was (cutAt).
        ['- [ ] a| ', '- [ ] a \n- [ ] |'],
        ['- [ ] a| b', '- [ ] a\n- [ ] |b'],
        ['- a  |', '- a  \n- |'],
        ['-  a|', '-  a\n- |'],
        ['- [ ]  a|', '- [ ]  a\n- [ ] |'],
        ['- [ ]|', '- [ ]\n- |'],
        ['- [ ] a\n\t- [ ] b|', '- [ ] a\n\t- [ ] b\n\t- [ ] |'],
        ['- [ ] a\n    - [ ] b|', '- [ ] a\n    - [ ] b\n    - [ ] |'],
        ['- [ ] a\n\n- [ ] b|', '- [ ] a\n\n- [ ] b\n- [ ] |'],
        ['1. a|', '1. a\n2. |'],
        ['1) a|', '1) a\n2) |'],
        ['3. a|', '3. a\n4. |'],
        ['1.  a|', '1.  a\n2. |'],
        ['1. [ ] a|', '1. [ ] a\n2. [ ] |'],
        ['1. [x] a|', '1. [x] a\n2. [ ] |'],
        ['1. a|\n2. b\n3. c', '1. a\n2. |\n3. b\n4. c'],
        ['1. a\n2. b|\n3. c', '1. a\n2. b\n3. |\n4. c'],
        ['1. a\n\t1. b|\n2. c', '1. a\n\t1. b\n\t2. |\n2. c'],
        // An empty item: a level up, or its markup gone
        ['- [ ] |', '|'],
        ['- |', '|'],
        ['- [x] |', '|'],
        ['- [/] |', '|'],
        ['- a\n- |', '- a\n|'],
        ['- [ ] a\n\t- [ ] |', '- [ ] a\n- [ ] |'],
        ['- [ ] a\n    - [ ] |', '- [ ] a\n- [ ] |'],
        ['- [ ] a\n  - [ ] |', '- [ ] a\n- [ ] |'],
        ['- [ ] a\n\t- [ ] b\n\t\t- [ ] |', '- [ ] a\n\t- [ ] b\n\t- [ ] |'],
        ['- a\n\t- [ ] |', '- a\n- [ ] |'],
        ['- [x] a\n\t- |', '- [x] a\n- |'],
        ['1. a\n\t- |', '1. a\n- |'],
        ['- a\n\t1. |', '- a\n1. |'],
        ['\t- [x] |', '- [x] |'],
        ['- a\n    - b\n\t\t- |', '- a\n    - b\n\t- |'],
        ['- a\n    - b\n        - |', '- a\n    - b\n    - |'],
        ['- a\n  - b\n    - |', '- a\n  - b\n- |'],
        ['- a\n\t  - |', '- a\n\t- |'],
        ['- a\n      - |', '- a\n  - |'],
        ['1. a\n2. |\n3. c', '1. a\n|\n2. c'],
        ['1. a\n\t1. |', '1. a\n2. |'],
        // A line of whitespace alone
        ['\t|', '|'],
        ['para\n\t|', 'para\n|'],
        ['- [ ] a\n\t|', '- [ ] a\n|'],
        ['- a\n\t- b\n\t\t|', '- a\n\t- b\n|'],
        ['- a\n    |', '- a\n|'],
        // No list: the indent goes on as it is spelled
        ['plain|', 'plain\n|'],
        ['\tplain|', '\tplain\n\t|'],
        ['  plain|', '  plain\n  |'],
        ['- [ ] a\n\tnote|', '- [ ] a\n\tnote\n\t|'],
        ['|- [ ] a', '\n|- [ ] a'],
        ['- [| ] a', '- [\n|] a'],
        ['plain| text', 'plain\n|text'],
    ];
    it.each(cases)('%j → %j', (before, after) => {
        expect(shown(run(stateWith(before), newlineContinuingList))).toBe(after);
    });

    it('keeps the spelling of the indent at the same depth, whatever the unit', () => {
        expect(shown(run(stateWith('- a\n    - b|', '\t'), newlineContinuingList))).toBe('- a\n    - b\n    - |');
        expect(shown(run(stateWith('- a\n\t- b|', '  '), newlineContinuingList))).toBe('- a\n\t- b\n\t- |');
    });
});

describe('numbering, as Obsidian\'s editor numbers after any change', () => {
    const typed: [string, string, string][] = [
        ['1. a\n3. b|\n7. c', 'x', '1. a\n2. bx|\n3. c'],
        ['1. a\n2. b\n\n1. c|', 'x', '1. a\n2. b\n\n3. cx|'],
        ['1. a\n3. b\n\npara|', 'x', '1. a\n2. b\n\nparax|'],
        ['1. a\n3. b\n- c|', 'x', '1. a\n2. b\n- cx|'],
        ['1. a\n\t1. x\n\t5. y\n3. b|', 'z', '1. a\n\t1. x\n\t2. y\n2. bz|'],
        ['1. a|\n2. b\n3. c', '\n9. p\n9. q', '1. a\n2. p\n3. q|\n4. b\n5. c'],
        ['- [ ] a\n\t1. x\n\t3. y|', 'z', '- [ ] a\n\t1. x\n\t2. yz|'],
        ['1. a\n- b\n3. c|', 'z', '1. a\n- b\n1. cz|'],
        ['- b\n3. c|', 'z', '- b\n1. cz|'],
        ['para\n3. c|', 'z', 'para\n3. cz|'],
        ['para\n\n3. c|', 'z', 'para\n\n3. cz|'],
        ['# h\n3. c|', 'z', '# h\n3. cz|'],
        ['1. a\n\n\n3. c|', 'z', '1. a\n\n\n2. cz|'],
        ['1. a\npara\n3. c|', 'z', '1. a\npara\n2. cz|'],
        ['1. a\n\tpara\n3. c|', 'z', '1. a\n\tpara\n2. cz|'],
        ['1) a\n3. b|', 'z', '1) a\n2. bz|'],
        ['1. a\n  1. x\n  3. y|', 'z', '1. a\n  2. x\n  3. yz|'],
        ['1. a\n- b\n\n3. c|', 'z', '1. a\n- b\n\n1. cz|'],
        ['0. a\n5. b|', 'z', '0. a\n1. bz|'],
        ['3. c|', 'z', '3. cz|'],
        ['1. a\n\t- b\n3. c|', 'z', '1. a\n\t- b\n2. cz|'],
        ['- x\n\t4. a\n\t9. b|', 'z', '- x\n\t4. a\n\t5. bz|'],
        ['1. a\n\npara\n\n3. c|', 'z', '1. a\n\npara\n\n3. cz|'],
        ['1. a\n\n   para\n\n3. c|', 'z', '1. a\n\n   para\n\n2. cz|'],
    ];
    it.each(typed)('%j, typing %j → %j', (before, text, after) => {
        expect(shown(type(stateWith(before), text))).toBe(after);
    });

    it('numbers again after a line is deleted, or cut and pasted above the first item, which keeps its number', () => {
        const deleted = stateWith('1. a\n|2. b\n3. c');
        expect(shown(deleted.update({ changes: { from: 5, to: 10 } }).state)).toBe('1. a\n|2. c');
        let pasted = stateWith('1. a\n2. b|\n3. c');
        pasted = pasted.update({ changes: { from: 5, to: 10 } }).state;
        pasted = pasted.update({ changes: { from: 0, insert: '2. b\n' }, userEvent: 'input.paste' }).state;
        expect(pasted.doc.toString()).toBe('2. b\n3. a\n4. c');
    });

    it('moves lines with Alt+ArrowUp/Down as Obsidian\'s "move line", leaving the numbers in place', () => {
        expect(shown(run(stateWith('1. a\n2. b|\n3. c'), moveLineUpKeepingNumbers))).toBe('1. b|\n2. a\n3. c');
        expect(shown(run(stateWith('1. a\n2. b|\n3. c'), moveLineDownKeepingNumbers))).toBe('1. a\n2. c\n3. b|');
        expect(shown(run(stateWith('5. a\n6. b|\n7. c'), moveLineUpKeepingNumbers))).toBe('5. b|\n6. a\n7. c');
        expect(shown(run(run(stateWith('1. a\n2. b\n3. c|'), moveLineUpKeepingNumbers), moveLineUpKeepingNumbers)))
            .toBe('1. c|\n2. a\n3. b');
        expect(shown(run(stateWith('- [ ] a\n- [ ] b|'), moveLineUpKeepingNumbers))).toBe('- [ ] b|\n- [ ] a');
    });

    it('starts a list at 1 for an item indented under another by Tab, and numbers it again after Shift+Tab', () => {
        const indented = run(stateWith('1. a\n2. b|\n3. c'), indentMoreRestartingLists);
        expect(shown(indented)).toBe('1. a\n\t1. b|\n2. c');
        expect(shown(run(stateWith('1. a\n\t1. x\n\t2. y|'), indentLess))).toBe('1. a\n\t1. x\n2. y|');
    });

    it('keeps a changed number and the numbers after it in one undo step with the change', () => {
        const s = type(stateWith('1. a\n3. b|'), 'x');
        expect(s.doc.toString()).toBe('1. a\n2. bx');
    });
});

describe('the line map through list edits', () => {
    function edit(lines: string[], at: { line: number; ch: number }, command: StateCommand) {
        let s = childrenState(lines, '\t', undefined, {});
        s = s.update({ selection: { anchor: s.doc.line(at.line).from + at.ch } }).state;
        return run(s, command);
    }

    it('keeps the line Enter goes on from, and makes the new item new', () => {
        const s = edit(['- [ ] a', '- [ ] b'], { line: 1, ch: 7 }, newlineContinuingList);
        const parent = parentState('- [ ] P', undefined, {});
        expect(draftOf(parent, s).children).toEqual([
            { text: '- [ ] a', was: 1 },
            { text: '- [ ] ', was: null },
            { text: '- [ ] b', was: 2 },
        ]);
    });

    it('keeps the line Enter goes on from before whitespace up to its end, which stays', () => {
        const s = edit(['- [ ] a '], { line: 1, ch: 7 }, newlineContinuingList);
        expect(draftOf(parentState('P', undefined, {}), s).children.map(line => line.was)).toEqual([1, null]);
    });

    it('keeps the lines renumbered, and an empty item given up a level', () => {
        let s = edit(['1. a', '2. b', '3. c'], { line: 1, ch: 4 }, newlineContinuingList);
        expect(draftOf(parentState('P', undefined, {}), s).children).toEqual([
            { text: '1. a', was: 1 },
            { text: '2. ', was: null },
            { text: '3. b', was: 2 },
            { text: '4. c', was: 3 },
        ]);
        s = edit(['- a', '\t- '], { line: 2, ch: 3 }, newlineContinuingList);
        expect(draftOf(parentState('P', undefined, {}), s).children).toEqual([
            { text: '- a', was: 1 },
            { text: '- ', was: 2 },
        ]);
    });
});

describe('Enter in the parent\'s line', () => {
    it('sends the text after the caret to the first child line, with the parent\'s markup and an open checkbox', () => {
        expect(breakParent('- [x] task more', 10, 10)).toEqual({ cut: 10, child: '- [ ] more', caret: 6 });
        expect(breakParent('* note text', 6, 6)).toEqual({ cut: 6, child: '* text', caret: 2 });
        expect(breakParent('3) [ ] step next', 11, 11)).toEqual({ cut: 11, child: '1) [ ] next', caret: 7 });
        expect(breakParent('plain text', 5, 5)).toEqual({ cut: 5, child: 'text', caret: 0 });
    });

    it('makes an empty child item at the end of the line, and in the markup leaves the line whole', () => {
        expect(breakParent('- [ ] task', 10, 10)).toEqual({ cut: 10, child: '- [ ] ', caret: 6 });
        expect(breakParent('- [ ] task', 3, 3)).toEqual({ cut: null, child: '- [ ] ', caret: 6 });
    });

    it('drops a selection', () => {
        expect(breakParent('- [ ] a b c', 7, 9)).toEqual({ cut: 7, child: '- [ ] c', caret: 6 });
    });
});
