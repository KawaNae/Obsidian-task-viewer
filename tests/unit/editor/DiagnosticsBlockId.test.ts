import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import type { DecorationSet, EditorView } from '@codemirror/view';
import { createDiagnosticsExtension } from '../../../src/editor/DiagnosticsExtension';

/**
 * A flow on a task line ends where the line's `^id` begins: the parser takes
 * the `^id` off the line before it cuts the command (`extractLineBlockId`),
 * and the editor's diagnostics cut it the same way, so an `^id` after a flow
 * is no part of the command they grade.
 */

/** The marks the diagnostics put on `lines`, all of them in view, as `class: title`. */
function marksOn(lines: string[]): string[] {
    const state = EditorState.create({ doc: lines.join('\n') });
    const view = { state, visibleRanges: [{ from: 0, to: state.doc.length }] } as unknown as EditorView;
    // The plugin's own constructor, run on a view that has only what it reads.
    const plugin = createDiagnosticsExtension() as unknown as { create: (view: EditorView, arg: undefined) => { decorations: DecorationSet } };
    const { decorations } = plugin.create(view, undefined);
    const found: string[] = [];
    decorations.between(0, state.doc.length, (_from, _to, deco) => {
        const spec = deco.spec as { class?: string; attributes?: { title?: string } };
        found.push(`${spec.class ?? ''}: ${spec.attributes?.title ?? ''}`);
    });
    return found;
}

describe('an ^id after a flow on the task line', () => {
    it('is no part of the command: nothing is marked', () => {
        expect(marksOn(['- [ ] A @2026-09-26 ==> +1d ^keep'])).toEqual([]);
        expect(marksOn(['- [ ] A @2026-09-26 ==> every mon ^tv-t-1'])).toEqual([]);
    });

    it('leaves a command that is wrong before it marked', () => {
        expect(marksOn(['- [ ] A @2026-09-26 ==> +1d nonsense ^keep']).some(mark => mark.includes('tv-diag--error'))).toBe(true);
    });
});
