import { describe, it, expect } from 'vitest';
import { FrontmatterValueSuggest } from '../../../src/suggest/FrontmatterValueSuggest';
import { COLOR_VALUES, LINE_STYLE_VALUES } from '../../../src/suggest/ScopeValues';
import { DEFAULT_SETTINGS } from '../../../src/types';

/**
 * The plugin's own writes through the editor's API cannot change a status
 * character (R0's lead decision: counted whole in stage X). Of the four, two
 * write a line — the color and the line-style suggests, `editor.replaceRange`
 * of the value of `key:` — and two only dispatch effects (`TaskMenuExtension`). The two
 * that write are offered only on a frontmatter line of their key, which is no
 * task line: what they write over, and what they write, never completes a
 * task, so they never fire (and are no operation that could).
 */

/** An editor over `text` with the cursor at the end of line `line`. */
function editorOver(text: string, line: number) {
    const lines = text.split('\n');
    return {
        cursor: { line, ch: lines[line].length },
        editor: {
            getLine: (n: number) => lines[n],
            lineCount: () => lines.length,
        },
    };
}

const plugin = { settings: { ...DEFAULT_SETTINGS } };
const color = new FrontmatterValueSuggest({} as never, plugin as never, COLOR_VALUES);
const lineStyle = new FrontmatterValueSuggest({} as never, plugin as never, LINE_STYLE_VALUES);
const keys = DEFAULT_SETTINGS.scopeKeys;

describe('the suggests that write through the editor', () => {
    for (const [name, suggest, key] of [['color', color, keys.color], ['line style', lineStyle, keys.linestyle]] as const) {
        it(`${name}: offered on its key in the frontmatter`, () => {
            const { editor, cursor } = editorOver(`---\n${key}: re\n---\n- [ ] T`, 1);
            expect(suggest.onTrigger(cursor as never, editor as never)).not.toBeNull();
        });

        it(`${name}: not offered on a task line, nor on its key past the frontmatter`, () => {
            const task = editorOver(`---\ntags: a\n---\n- [ ] ${key}: re`, 3);
            expect(suggest.onTrigger(task.cursor as never, task.editor as never)).toBeNull();
            const body = editorOver(`---\ntags: a\n---\n${key}: re`, 3);
            expect(suggest.onTrigger(body.cursor as never, body.editor as never)).toBeNull();
        });
    }
});
