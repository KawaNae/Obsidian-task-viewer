import type { Editor } from 'obsidian';
import type { EditorView } from '@codemirror/view';

/**
 * The CodeMirror 6 view behind an Obsidian Editor.
 *
 * `Editor` has no `cm` in Obsidian's typings — it is an internal handle, and
 * reaching for it is a deliberate escape from the public API. Three call
 * sites each wrote their own `as any` to do it; keeping the escape here
 * means one place to look when Obsidian eventually renames or removes it,
 * and the same treatment the @ts-ignore sites get: named, explained, alone.
 *
 * Returns undefined in Live Preview's source-mode-less states and on any
 * editor that is not CM6-backed.
 */
export function editorCm(editor: Editor): EditorView | undefined {
    return (editor as unknown as { cm?: EditorView }).cm;
}
