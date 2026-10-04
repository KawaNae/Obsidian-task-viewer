import {
    EditorSuggest, type App, type Editor, type EditorPosition, type EditorSuggestContext,
    type EditorSuggestTriggerInfo,
} from 'obsidian';
import type { PluginContext } from '../PluginContext';
import { FrontmatterLineEditor } from '../services/persistence/utils/FrontmatterLineEditor';
import type { ScopeValueKind } from './ScopeValues';

/**
 * The values of a scope key (a color, a line style) offered in the editor,
 * on the line of that key in the note's frontmatter, as the cursor stands
 * in its value. One class for every kind (`ScopeValueKind`).
 *
 * The frontmatter is where the reading of a note finds it
 * (`FrontmatterLineEditor.findEnd`, the outline's), and a key line is one
 * as the frontmatter writes read it. Picking a value replaces the value
 * alone (`FrontmatterLineEditor.valueRange`): the key, the separator and a
 * comment after the value stay as they are spelled.
 */
export class FrontmatterValueSuggest extends EditorSuggest<string> {
    constructor(app: App, private readonly plugin: PluginContext, private readonly kind: ScopeValueKind) {
        super(app);
    }

    onTrigger(cursor: EditorPosition, editor: Editor): EditorSuggestTriggerInfo | null {
        // The line first: the note is read only on a line of the key.
        const at = FrontmatterLineEditor.valueRange(editor.getLine(cursor.line), this.kind.key(this.plugin.settings));
        if (!at || cursor.ch < at.start || cursor.line === 0) return null;
        const lines = Array.from({ length: editor.lineCount() }, (_, i) => editor.getLine(i));
        if (cursor.line >= FrontmatterLineEditor.findEnd(lines)) return null;
        return {
            start: { line: cursor.line, ch: at.start },
            end: cursor,
            query: editor.getLine(cursor.line).substring(at.start, cursor.ch),
        };
    }

    getSuggestions(context: EditorSuggestContext): string[] {
        return this.kind.candidates(context.query);
    }

    renderSuggestion(value: string, el: HTMLElement): void {
        this.kind.render(value, el);
    }

    selectSuggestion(value: string): void {
        const context = this.context;
        if (!context) return;
        const { editor, start } = context;
        const at = FrontmatterLineEditor.valueRange(editor.getLine(start.line), this.kind.key(this.plugin.settings));
        if (!at) return;
        editor.replaceRange(value, { line: start.line, ch: at.start }, { line: start.line, ch: at.end });
        editor.setCursor({ line: start.line, ch: at.start + value.length });
    }
}
