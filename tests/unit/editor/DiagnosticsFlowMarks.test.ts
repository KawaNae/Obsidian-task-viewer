import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import type { DecorationSet, EditorView } from '@codemirror/view';
import { createDiagnosticsExtension } from '../../../src/editor/DiagnosticsExtension';
import { DEFAULT_SETTINGS, type TaskViewerSettings } from '../../../src/types';

/**
 * Where the editor's diagnostics put their marks on a flow program, to the
 * column: the task line's tail and its `- ==>` lines read as one program
 * (`readFlow`), each diagnostic mapped back to the line and column it was
 * written at. Pinned so that a change in how the program is read never moves
 * a mark the user sees.
 */

/** The marks the diagnostics put on `lines`, all in view, as `line:from-to class title`. */
function marksOn(lines: string[], settings: TaskViewerSettings = DEFAULT_SETTINGS): string[] {
    const state = EditorState.create({ doc: lines.join('\n') });
    const view = { state, visibleRanges: [{ from: 0, to: state.doc.length }] } as unknown as EditorView;
    const plugin = createDiagnosticsExtension(() => settings) as unknown as { create: (view: EditorView, arg: undefined) => { decorations: DecorationSet } };
    const { decorations } = plugin.create(view, undefined);
    const found: string[] = [];
    decorations.between(0, state.doc.length, (from, to, deco) => {
        const spec = deco.spec as { class?: string; attributes?: { title?: string } };
        const line = state.doc.lineAt(from);
        found.push(`${line.number - 1}:${from - line.from}-${to - line.from} ${spec.class ?? ''} ${spec.attributes?.title ?? ''}`);
    });
    return found;
}

const D = '@2026-09-24';
const SHAPES: Array<[string, string[], Partial<TaskViewerSettings>?]> = [
    ['an error on the task line', [`- [ ] A ${D} ==> evry mon`]],
    ['a tail padded with spaces', [`- [ ] A ${D} ==>    evry mon   `]],
    ['an error on a flow line', [`- [ ] A ${D} ==> every mon`, '\t- ==> nonsense']],
    ['an error on a flow line padded with spaces', [`- [ ] A ${D} ==> every mon`, '\t- ==>    nonsense  ']],
    ['a clause across two lines', [`- [ ] A ${D} ==> every`, '\t- ==> mon']],
    ['a flow only in flow lines', [`- [ ] A ${D}`, '\t- ==> evry mon', '\t- ==> x3']],
    ['a marker at the end of the task line', [`- [ ] A ${D} ==>`, '\t- ==> evry mon']],
    ['a bare marker', [`- [ ] A ${D} ==> `]],
    ['a modifier alone', [`- [ ] A ${D} ==> x3`]],
    ['an unfinished clause', [`- [ ] A ${D} ==> every`]],
    ['an ^id after the command', [`- [ ] A ${D} ==> evry ^keep`]],
    ['a date error and a flow error', [`- [ ] A @2026-09-24T10:00>2026-09-23T09:00 ==> evry`]],
    ['flow lines under a note and in a fence', [
        `- [ ] A ${D} ==> every mon`, '\t- note', '\t\t- ==> evry', '\t```', '\t- ==> evry', '\t```', '\t- ==> x3',
    ]],
    ['a nested task with its own flow', [
        `- [ ] A ${D} ==> every mon`, `\t- [ ] B ${D} ==> evry`, '\t\t- ==> x2', '\t- ==> x3',
    ]],
    ['children that stopped travelling', [`- [ ] A ${D} ==> every mon`, '\t- a child note']],
    ['a read-only notation', ['- [ ] A 📅 2026-09-24 ==> every mon', '\t- ==> x3'], { enableTasksPlugin: true }],
    ['an unfinished call, padded', [`- [ ] A ${D} ==>  at(   `]],
    ['an unfinished call on a flow line', [`- [ ] A ${D}`, '\t- ==>   at(  ']],
    ['a missing weekday before a flow line', [`- [ ] A ${D} ==> every mon ,`, '\t- ==> x3']],
    ['a modifier before a flow line', [`- [ ] A ${D} ==> x3 `, '\t- ==> x2']],
    ['a paragraph going on', [`- [ ] A ${D} ==> every mon`, 'memo at column 0', '\t- ==> evry']],
];

describe('the marks the editor puts on a flow program', () => {
    for (const [name, lines, settings] of SHAPES) {
        it(name, () => {
            expect(marksOn(lines, { ...DEFAULT_SETTINGS, ...settings })).toMatchSnapshot();
        });
    }
});
