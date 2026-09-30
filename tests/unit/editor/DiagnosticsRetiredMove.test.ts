import { describe, it, expect } from 'vitest';
import { EditorState } from '@codemirror/state';
import type { DecorationSet, EditorView } from '@codemirror/view';
import { createDiagnosticsExtension } from '../../../src/editor/DiagnosticsExtension';

/**
 * `move()` names no heading and is retired (2026-09-28), as a move to
 * another note is: the editor says so where it is written, as a warning, and
 * the rest of the command is read. `move([[#heading]])` is marked nothing.
 */

/** The marks the diagnostics put on `lines`, all of them in view, as `class: title`. */
function marksOn(lines: string[]): string[] {
    const state = EditorState.create({ doc: lines.join('\n') });
    const view = { state, visibleRanges: [{ from: 0, to: state.doc.length }] } as unknown as EditorView;
    const plugin = createDiagnosticsExtension() as unknown as { create: (view: EditorView, arg: undefined) => { decorations: DecorationSet } };
    const { decorations } = plugin.create(view, undefined);
    const found: string[] = [];
    decorations.between(0, state.doc.length, (_from, _to, deco) => {
        const spec = deco.spec as { class?: string; attributes?: { title?: string } };
        found.push(`${spec.class ?? ''}: ${spec.attributes?.title ?? ''}`);
    });
    return found;
}

describe('a retired move() in the editor', () => {
    it('is marked as a warning, on the task line and on a command line below it', () => {
        for (const lines of [
            ['- [ ] A @2026-09-26 ==> every mon move()', '## Done'],
            ['- [ ] A @2026-09-26', '    - ==> move()', '## Done'],
        ]) {
            const marks = marksOn(lines);
            expect(marks).toHaveLength(1);
            expect(marks[0]).toContain('tv-diag--warning');
            expect(marks[0]).toContain('move([[#');
        }
    });

    it('marks nothing on a move to a heading', () => {
        expect(marksOn(['- [ ] A @2026-09-26 ==> every mon move([[#Done]])', '## Done'])).toEqual([]);
    });
});
