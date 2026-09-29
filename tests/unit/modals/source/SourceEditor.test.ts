import { describe, it, expect } from 'vitest';
import { CompletionContext, insertBracket, type CompletionResult } from '@codemirror/autocomplete';
import { indentLess, indentMore } from '@codemirror/commands';
import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state';
import {
    bracketPairing, childrenState, draftOf, indentColumns, parentState,
} from '../../../../src/modals/form/source/SourceEditor';
import { newlineContinuingList } from '../../../../src/modals/form/source/ListMarkup';
import { linkTagCompletionSource } from '../../../../src/modals/form/source/SourceCompletion';
import { BRACKET_PAIRS } from '../../../../src/utils/BracketRules';

/**
 * The source editor's behavior at the level of its states: what the parent
 * editor takes, how the children's editor indents and breaks lines, how
 * brackets pair, what links complete to, and the draft handed back. The
 * views, keys and focus are not run here (no DOM under `node`).
 */

/** `text` with the caret at '|'. */
function stateWith(text: string, extensions = bracketPairing): EditorState {
    const at = text.indexOf('|');
    return EditorState.create({
        doc: text.replace('|', ''),
        selection: EditorSelection.cursor(at),
        extensions,
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
    for (const ch of text) {
        const tr = insertBracket(state, ch)
            ?? state.update(state.replaceSelection(ch), { userEvent: 'input.type' });
        state = tr.state;
    }
    return state;
}

describe('parent editor: one line', () => {
    it('does not take a change that would break the line', () => {
        const s = parentState('- [ ] task', undefined, {});
        expect(s.update({ changes: { from: 3, insert: '\n' } }).state.doc.toString()).toBe('- [ ] task');
        expect(s.update({ changes: { from: 10, insert: 'a\nb' } }).state.doc.toString()).toBe('- [ ] task');
    });

    it('takes a change within the line', () => {
        const s = parentState('- [ ] task', undefined, {});
        expect(s.update({ changes: { from: 3, to: 4, insert: 'x' } }).state.doc.toString()).toBe('- [x] task');
    });
});

describe('children editor: indent', () => {
    it('indents and outdents by the unit it is given', () => {
        let s = childrenState(['- a', '- b'], '  ', undefined, {});
        s = s.update({ selection: EditorSelection.cursor(s.doc.line(2).from) }).state;
        s = run(s, indentMore);
        expect(s.doc.toString()).toBe('- a\n  - b');
        s = run(s, indentLess);
        expect(s.doc.toString()).toBe('- a\n- b');

        let t = childrenState(['- a', '- b'], '\t', undefined, {});
        t = t.update({ selection: EditorSelection.cursor(t.doc.line(2).from) }).state;
        t = run(t, indentMore);
        expect(t.doc.toString()).toBe('- a\n\t- b');
    });

    it('takes a tab as four columns for the width it shows a level at', () => {
        expect(indentColumns('\t')).toBe(4);
        expect(indentColumns('  ')).toBe(2);
        expect(indentColumns('    ')).toBe(4);
    });

    it('breaks a line keeping its indent as it is spelled', () => {
        let s = childrenState(['- a', ' \tnote'], '    ', undefined, {});
        s = s.update({ selection: EditorSelection.cursor(s.doc.length) }).state;
        s = run(s, newlineContinuingList);
        expect(shown(s)).toBe('- a\n \tnote\n \t|');
    });

    it('breaks a line inside its indent keeping the part before the caret', () => {
        let s = childrenState(['        - a'], '    ', undefined, {});
        s = s.update({ selection: EditorSelection.cursor(4) }).state;
        s = run(s, newlineContinuingList);
        expect(shown(s)).toBe('    \n    |    - a');
    });
});

describe('bracket pairing: as BracketRules says', () => {
    it('closes every pair of BRACKET_PAIRS at the end', () => {
        for (const [open, close] of Object.entries(BRACKET_PAIRS)) {
            expect(shown(type(stateWith('|'), open))).toBe(`${open}|${close}`);
        }
    });

    it('closes before whitespace and before a closer, not before a word', () => {
        expect(shown(type(stateWith('a| b'), '[['))).toBe('a[[|]] b');
        expect(shown(type(stateWith('(|)'), '['))).toBe('([|])');
        expect(shown(type(stateWith('|test #tag'), '[['))).toBe('[[|test #tag');
        expect(shown(type(stateWith('|テスト'), '「'))).toBe('「|テスト');
    });

    it('closes each pair before each closer', () => {
        const closers = Object.values(BRACKET_PAIRS);
        for (const [open, close] of Object.entries(BRACKET_PAIRS)) {
            for (const after of closers) {
                expect(shown(type(stateWith(`|${after}`), open))).toBe(`${open}|${close}${after}`);
            }
        }
    });

    it('steps over a closer it inserted', () => {
        expect(shown(type(stateWith('|'), '[[a]]'))).toBe('[[a]]|');
        expect(shown(type(stateWith('|'), '「a」'))).toBe('「a」|');
    });

    it('pairs nothing else', () => {
        expect(insertBracket(stateWith('|'), '"')).toBeNull();
        expect(insertBracket(stateWith('|'), '{')).toBeNull();
    });
});

describe('link and tag completion', () => {
    const note = { basename: 'ノート', parent: { path: 'notes' } };
    const app = {
        vault: { getMarkdownFiles: () => [note, { basename: 'other', parent: { path: '' } }] },
        metadataCache: {
            getFirstLinkpathDest: (p: string) => (p === 'ノート' ? note : null),
            getFileCache: () => ({
                headings: [{ heading: '見出し', level: 2, position: { start: { line: 3 } } }],
            }),
            getTags: () => ({ '#tag': 1, '#other': 2 }),
        },
    } as any;
    const source = linkTagCompletionSource(app);

    function complete(state: EditorState): CompletionResult | null {
        return source(new CompletionContext(state, state.selection.main.head, false)) as CompletionResult | null;
    }

    /**
     * Pick the option labelled `label`, as CodeMirror applies it: its apply
     * over the result's range, on a stand-in for the view (it needs only the
     * state and dispatch).
     */
    function pick(state: EditorState, label: string): EditorState {
        const result = complete(state)!;
        const option = result.options.find(o => o.label === label)!;
        let now = state;
        const view = { get state() { return now; }, dispatch: (spec: any) => { now = now.update(spec).state; } };
        (option.apply as (...args: unknown[]) => void)(view, option, result.from, result.to ?? state.selection.main.head);
        return now;
    }

    it('offers notes after [[, from the trigger, unfiltered', () => {
        const s = stateWith('- [ ] a [[ノ|]]');
        const result = complete(s)!;
        expect(result.from).toBe(8);
        expect(result.filter).toBe(false);
        expect(result.options.map(o => o.label)).toEqual(['ノート']);
    });

    it('offers headings after [[note#, and tags after #', () => {
        expect(complete(stateWith('[[ノート#|]]'))!.options.map(o => [o.label, o.detail])).toEqual([['見出し', 'H2']]);
        const tags = complete(stateWith('a #t|'))!;
        expect(tags.from).toBe(2);
        expect(tags.options.map(o => o.label)).toEqual(['tag', 'other']);
    });

    it('offers nothing outside a trigger, or for a # inside a word', () => {
        expect(complete(stateWith('plain|'))).toBeNull();
        expect(complete(stateWith('a#t|'))).toBeNull();
        expect(complete(stateWith('[[ノート]] x|'))).toBeNull();
    });

    it('reads the caret line only', () => {
        const s = stateWith('[[x\n#t|');
        expect(complete(s)!.from).toBe(4);
    });

    it('takes over the closers pairing left after the caret', () => {
        expect(shown(pick(stateWith('- a [[|]]'), 'ノート'))).toBe('- a [[ノート]]|');
        expect(shown(pick(stateWith('[[ノート#見|]] rest'), '見出し'))).toBe('[[ノート#見出し]]| rest');
        expect(shown(pick(stateWith('[[|]]\nnext'), 'ノート'))).toBe('[[ノート]]|\nnext');
    });

    it('leaves text after the caret that is not its closers', () => {
        expect(shown(pick(stateWith('[[|test #tag'), 'ノート'))).toBe('[[ノート]]|test #tag');
        expect(shown(pick(stateWith('#t| rest'), 'tag'))).toBe('#tag| rest');
    });
});

describe('draft', () => {
    it('hands back the parent line and each child with where it came from', () => {
        const parent = parentState('- [ ] p', undefined, {});
        let children = childrenState(['- [ ] a', '    - [ ] b'], '    ', undefined, {});
        children = children.update({ changes: { from: 0, insert: '- new\n' } }).state;
        children = children.update({ changes: { from: 9, to: 10, insert: 'x' } }).state;
        expect(draftOf(parent, children)).toEqual({
            parent: '- [ ] p',
            children: [
                { text: '- new', was: null },
                { text: '- [x] a', was: 1 },
                { text: '    - [ ] b', was: 2 },
            ],
        });
    });

    it('has no children when the children editor is empty', () => {
        const parent = parentState('- [ ] p', undefined, {});
        expect(draftOf(parent, childrenState([], '\t', undefined, {})).children).toEqual([]);
        let emptied = childrenState(['- a'], '\t', undefined, {});
        emptied = emptied.update({ changes: { from: 0, to: 3 } }).state;
        expect(draftOf(parent, emptied).children).toEqual([]);
    });

    it('makes every child typed into an editor opened empty new', () => {
        const parent = parentState('- [ ] p', undefined, {});
        let children = childrenState([], '\t', undefined, {});
        children = children.update({ changes: { from: 0, insert: '- a' } }).state;
        expect(draftOf(parent, children).children).toEqual([{ text: '- a', was: null }]);
    });
});
