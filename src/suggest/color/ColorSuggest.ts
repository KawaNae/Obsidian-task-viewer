import { App, Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, TFile } from 'obsidian';
import TaskViewerPlugin from '../../main';
import { filterColors, renderColorSuggestion } from './colorUtils';

/**
 * ColorSuggest - EditorSuggest for Source mode frontmatter
 * Provides color suggestions when editing timeline-color in YAML frontmatter
 */
export class ColorSuggest extends EditorSuggest<string> {
    plugin: TaskViewerPlugin;

    constructor(app: App, plugin: TaskViewerPlugin) {
        super(app);
        this.plugin = plugin;
    }

    onTrigger(cursor: EditorPosition, editor: Editor, file: TFile): EditorSuggestTriggerInfo | null {
        const line = editor.getLine(cursor.line);
        const colorKey = this.plugin.settings.frontmatterTaskKeys.color;
        const escapedColorKey = colorKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Regex to capture:
        // 1. The key (exact match)
        // 2. The separator (colon + whitespace)
        // 3. The value (rest of the line)
        const regex = new RegExp(`^(${escapedColorKey})(\\s*:\\s*)(.*)$`);
        const match = line.match(regex);

        if (match) {
            // Check if we are inside the frontmatter block
            const content = editor.getValue();
            const frontmatterRegex = /^---\n([\s\S]*?)\n---/;
            const frontmatterMatch = content.match(frontmatterRegex);

            if (frontmatterMatch) {
                const frontmatterEndIndex = frontmatterMatch[0].length;
                const cursorOffset = editor.posToOffset(cursor);

                if (cursorOffset <= frontmatterEndIndex) {
                    // Calculate the start index of the value
                    // match[1] is key, match[2] is ": " (separator)
                    const valueStartIndex = match[1].length + match[2].length;

                    // If cursor is before the value starts (e.g. inside the key or separator), don't trigger
                    if (cursor.ch < valueStartIndex) {
                        return null;
                    }

                    // The query is the text from value start to cursor
                    const query = line.substring(valueStartIndex, cursor.ch);

                    return {
                        start: { line: cursor.line, ch: valueStartIndex },
                        end: cursor,
                        query: query
                    };
                }
            }
        }

        return null;
    }

    getSuggestions(context: EditorSuggestContext): string[] {
        return filterColors(context.query);
    }

    renderSuggestion(value: string, el: HTMLElement): void {
        renderColorSuggestion(value, el);
    }

    selectSuggestion(value: string, evt: MouseEvent | KeyboardEvent): void {
        if (this.context) {
            const colorKey = this.plugin.settings.frontmatterTaskKeys.color;
            // Replace the whole value part
            const newValue = `${colorKey}: ${value}`;
            this.context.editor.setLine(this.context.start.line, newValue);
        }
    }
}

