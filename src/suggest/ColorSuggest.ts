import { App, Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, TFile } from 'obsidian';
import TaskViewerPlugin from '../main';

const CSS_COLORS = [
    "aliceblue", "antiquewhite", "aqua", "aquamarine", "azure",
    "beige", "bisque", "black", "blanchedalmond", "blue", "blueviolet", "brown", "burlywood",
    "cadetblue", "chartreuse", "chocolate", "coral", "cornflowerblue", "cornsilk", "crimson", "cyan",
    "darkblue", "darkcyan", "darkgoldenrod", "darkgray", "darkgreen", "darkgrey", "darkkhaki", "darkmagenta", "darkolivegreen", "darkorange", "darkorchid", "darkred", "darksalmon", "darkseagreen", "darkslateblue", "darkslategray", "darkslategrey", "darkturquoise", "darkviolet", "deeppink", "deepskyblue", "dimgray", "dimgrey", "dodgerblue",
    "firebrick", "floralwhite", "forestgreen", "fuchsia",
    "gainsboro", "ghostwhite", "gold", "goldenrod", "gray", "green", "greenyellow", "grey",
    "honeydew", "hotpink",
    "indianred", "indigo", "ivory",
    "khaki",
    "lavender", "lavenderblush", "lawngreen", "lemonchiffon", "lightblue", "lightcoral", "lightcyan", "lightgoldenrodyellow", "lightgray", "lightgreen", "lightgrey", "lightpink", "lightsalmon", "lightseagreen", "lightskyblue", "lightslategray", "lightslategrey", "lightsteelblue", "lightyellow", "lime", "limegreen", "linen",
    "magenta", "maroon", "mediumaquamarine", "mediumblue", "mediumorchid", "mediumpurple", "mediumseagreen", "mediumslateblue", "mediumspringgreen", "mediumturquoise", "mediumvioletred", "midnightblue", "mintcream", "mistyrose", "moccasin",
    "navajowhite", "navy",
    "oldlace", "olive", "olivedrab", "orange", "orangered", "orchid",
    "palegoldenrod", "palegreen", "paleturquoise", "palevioletred", "papayawhip", "peachpuff", "peru", "pink", "plum", "powderblue", "purple",
    "rebeccapurple", "red", "rosybrown", "royalblue",
    "saddlebrown", "salmon", "sandybrown", "seagreen", "seashell", "sienna", "silver", "skyblue", "slateblue", "slategray", "slategrey", "snow", "springgreen", "steelblue",
    "tan", "teal", "thistle", "tomato", "turquoise",
    "violet",
    "wheat", "white", "whitesmoke",
    "yellow", "yellowgreen"
];

export class ColorSuggest extends EditorSuggest<string> {
    plugin: TaskViewerPlugin;

    constructor(app: App, plugin: TaskViewerPlugin) {
        super(app);
        this.plugin = plugin;
    }

    onTrigger(cursor: EditorPosition, editor: Editor, file: TFile): EditorSuggestTriggerInfo | null {
        const line = editor.getLine(cursor.line);
        const colorKey = this.plugin.settings.frontmatterColorKey;

        // Regex to capture:
        // 1. The key (exact match)
        // 2. The separator (colon + whitespace)
        // 3. The value (rest of the line)
        const regex = new RegExp(`^(${colorKey})(\\s*:\\s*)(.*)$`);
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
        const query = context.query.toLowerCase();
        return CSS_COLORS.filter(color => color.toLowerCase().includes(query));
    }

    renderSuggestion(value: string, el: HTMLElement): void {
        el.addClass('task-viewer-color-suggestion');
        const swatch = el.createDiv({ cls: 'color-swatch' });
        swatch.style.backgroundColor = value;
        swatch.style.width = '1em';
        swatch.style.height = '1em';
        swatch.style.display = 'inline-block';
        swatch.style.marginRight = '0.5em';
        swatch.style.border = '1px solid var(--background-modifier-border)';
        swatch.style.borderRadius = '2px';
        swatch.style.verticalAlign = 'middle';

        el.createSpan({ text: value });
    }

    selectSuggestion(value: string, evt: MouseEvent | KeyboardEvent): void {
        if (this.context) {
            const line = this.context.editor.getLine(this.context.start.line);
            const colorKey = this.plugin.settings.frontmatterColorKey;
            // Replace the whole value part
            const newValue = `${colorKey}: ${value}`;
            this.context.editor.setLine(this.context.start.line, newValue);
        }
    }
}
