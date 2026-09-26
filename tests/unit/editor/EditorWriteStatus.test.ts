import { describe, it, expect } from 'vitest';
import { ColorSuggest } from '../../../src/suggest/color/ColorSuggest';
import { LineStyleSuggest } from '../../../src/suggest/line/LineStyleSuggest';
import { DEFAULT_SETTINGS } from '../../../src/types';

/**
 * The plugin's own writes through the editor's API cannot change a status
 * character (R0's lead decision: counted whole in stage X). Of the four, two
 * write a line — the color and the line-style suggests, `editor.setLine` of
 * `key: value` — and two only dispatch effects (`TaskMenuExtension`). The two
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
            getValue: () => text,
            posToOffset: (pos: { line: number; ch: number }) =>
                lines.slice(0, pos.line).reduce((sum, l) => sum + l.length + 1, 0) + pos.ch,
        },
    };
}

const plugin = { settings: { ...DEFAULT_SETTINGS } };
const color = new ColorSuggest({} as never, plugin as never);
const lineStyle = new LineStyleSuggest({} as never, plugin as never);
const keys = DEFAULT_SETTINGS.scopeKeys;

describe('the suggests that write through the editor', () => {
    for (const [name, suggest, key] of [['color', color, keys.color], ['line style', lineStyle, keys.linestyle]] as const) {
        it(`${name}: offered on its key in the frontmatter`, () => {
            const { editor, cursor } = editorOver(`---\n${key}: re\n---\n- [ ] T`, 1);
            expect(suggest.onTrigger(cursor as never, editor as never, null as never)).not.toBeNull();
        });

        it(`${name}: not offered on a task line, nor on its key past the frontmatter`, () => {
            const task = editorOver(`---\ntags: a\n---\n- [ ] ${key}: re`, 3);
            expect(suggest.onTrigger(task.cursor as never, task.editor as never, null as never)).toBeNull();
            const body = editorOver(`---\ntags: a\n---\n${key}: re`, 3);
            expect(suggest.onTrigger(body.cursor as never, body.editor as never, null as never)).toBeNull();
        });
    }
});
