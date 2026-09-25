import type { Task } from '../types';
import type { ContentKey } from '../services/core/ContentKey';
import { keyOf } from './EditorDoc';
import type { EditorHandle } from './EditorWrite';

/** What the editor's menu asks of the index for the task on a line it shows. */
export interface ShownTaskLookup {
    /**
     * The task on `line` of content `key`, or undefined when no task stands
     * there; null when the index's last reading of the file is another
     * content (`TaskIndex.taskAtEditorLine`).
     */
    taskAtEditorLine(path: string, line: number, key: ContentKey): Task | undefined | null;
    /** Save what `editor` shows, and have the index read the file. */
    readShown(editor: EditorHandle): Promise<void>;
}

/**
 * The index's task on line `line` of what the editor shows: the task the
 * menu opened there is about. A line number counts only in the content it
 * is in, so the task is looked up only when the index last read what the
 * editor shows. When it has not — an edit not saved yet, a scan not come —
 * the editor is saved, the index made to read the file, and the task looked
 * up again (the user's decision (a), 2026-09-25 15:12).
 *
 * @returns the task, undefined when no task stands on the line, or null when
 * the index still reads another content, or the editor changed while it was
 * being read: the menu is not to be opened.
 */
export async function taskShownAt(editor: EditorHandle, path: string, line: number, lookup: ShownTaskLookup): Promise<Task | undefined | null> {
    const doc = editor.state.doc;
    const found = lookup.taskAtEditorLine(path, line, keyOf(doc));
    if (found !== null) return found;
    await lookup.readShown(editor);
    // Typed into meanwhile: the line may be another one now.
    if (editor.state.doc !== doc) return null;
    return lookup.taskAtEditorLine(path, line, keyOf(doc));
}
