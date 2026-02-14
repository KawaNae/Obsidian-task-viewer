import { App, Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, TFile } from 'obsidian';
import TaskViewerPlugin from '../main';
import { filterLineStyles, renderLineStyleSuggestion } from './lineStyleUtils';

/**
 * LineStyleSuggest - EditorSuggest for Source mode frontmatter.
 * Provides line style suggestions when editing the configured linestyle key in YAML frontmatter.
 */
export class LineStyleSuggest extends EditorSuggest<string> {
    plugin: TaskViewerPlugin;

    constructor(app: App, plugin: TaskViewerPlugin) {
        super(app);
        this.plugin = plugin;
    }

    onTrigger(cursor: EditorPosition, editor: Editor, file: TFile): EditorSuggestTriggerInfo | null {
        const line = editor.getLine(cursor.line);
        const linestyleKey = this.plugin.settings.frontmatterTaskKeys.linestyle;
        const escapedLinestyleKey = linestyleKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`^(${escapedLinestyleKey})(\\s*:\\s*)(.*)$`);
        const match = line.match(regex);

        if (!match) {
            return null;
        }

        const content = editor.getValue();
        const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
        const frontmatterMatch = content.match(frontmatterRegex);
        if (!frontmatterMatch) {
            return null;
        }

        const frontmatterEndIndex = frontmatterMatch[0].length;
        const cursorOffset = editor.posToOffset(cursor);
        if (cursorOffset > frontmatterEndIndex) {
            return null;
        }

        const valueStartIndex = match[1].length + match[2].length;
        if (cursor.ch < valueStartIndex) {
            return null;
        }

        const query = line.substring(valueStartIndex, cursor.ch);
        return {
            start: { line: cursor.line, ch: valueStartIndex },
            end: cursor,
            query,
        };
    }

    getSuggestions(context: EditorSuggestContext): string[] {
        return filterLineStyles(context.query);
    }

    renderSuggestion(value: string, el: HTMLElement): void {
        renderLineStyleSuggestion(value, el);
    }

    selectSuggestion(value: string, evt: MouseEvent | KeyboardEvent): void {
        if (!this.context) {
            return;
        }

        const linestyleKey = this.plugin.settings.frontmatterTaskKeys.linestyle;
        this.context.editor.setLine(this.context.start.line, `${linestyleKey}: ${value}`);
    }
}

