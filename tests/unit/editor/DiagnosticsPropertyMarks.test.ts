import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import type { DecorationSet, EditorView, ViewUpdate } from '@codemirror/view';
import { createDiagnosticsExtension } from '../../../src/editor/DiagnosticsExtension';
import { DEFAULT_SETTINGS, type TaskViewerSettings } from '../../../src/types';

/**
 * The editor marks what is wrong with a property line, or with a line under
 * one, on that line: an error for a key written twice, a warning for the
 * rest, with the sentence as its title.
 */

interface Plugin {
    decorations: DecorationSet;
    update(update: ViewUpdate): void;
}

function open(lines: string[], settings: TaskViewerSettings = DEFAULT_SETTINGS) {
    const state = EditorState.create({ doc: lines.join('\n') });
    const view = { state, visibleRanges: [{ from: 0, to: state.doc.length }] } as unknown as EditorView;
    const extension = createDiagnosticsExtension(() => settings) as unknown as { create: (view: EditorView, arg: undefined) => Plugin };
    return { state, view, plugin: extension.create(view, undefined) };
}

/** The marks as `[line, from column, to column, class]`, and their titles. */
function marksOf(state: EditorState, decorations: DecorationSet) {
    const found: { at: (string | number)[]; title: string }[] = [];
    decorations.between(0, state.doc.length, (from, to, deco) => {
        const spec = deco.spec as { class?: string; attributes?: { title?: string } };
        const line = state.doc.lineAt(from);
        found.push({ at: [line.number - 1, from - line.from, to - line.from, spec.class ?? ''], title: spec.attributes?.title ?? '' });
    });
    return found;
}

describe('property diagnostics in the editor', () => {
    it('marks a key written twice as an error on both lines, and an item as a warning on its own line', () => {
        const { state, plugin } = open(['# H', '- a:: 1', '- a:: 2', '- [ ] t', '    - area:: lab', '        - note']);
        const marks = marksOf(state, plugin.decorations);
        expect(marks.map(m => m.at)).toEqual([
            [1, 0, 7, 'tv-diag tv-diag--error'],
            [2, 0, 7, 'tv-diag tv-diag--error'],
            [5, 8, 14, 'tv-diag tv-diag--warning'],
        ]);
        expect(marks[0].title).toContain('`a::` is written on more than one line');
        expect(marks[2].title).toContain('`area::` has a value');
    });

    it('marks a task under a list on its line, beside what its date block says', () => {
        const { state, plugin } = open(['- [ ] t', '    - list::', '        - [ ] u']);
        expect(marksOf(state, plugin.decorations).map(m => m.at)).toEqual([[2, 8, 15, 'tv-diag tv-diag--warning']]);
    });

    it('reads the date keys again when the settings name others, the note unchanged', () => {
        const settings: TaskViewerSettings = { ...DEFAULT_SETTINGS, scopeKeys: { ...DEFAULT_SETTINGS.scopeKeys } };
        const { state, view, plugin } = open(['- [ ] t', '    - begin:: 2026-01-01'], settings);
        expect(marksOf(state, plugin.decorations)).toEqual([]);

        settings.scopeKeys.start = 'begin';
        plugin.update({ view, docChanged: false, viewportChanged: false } as unknown as ViewUpdate);
        expect(marksOf(state, plugin.decorations).map(m => m.at)).toEqual([[1, 4, 24, 'tv-diag tv-diag--warning']]);
    });
});
