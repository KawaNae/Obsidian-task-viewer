import { describe, it, expect } from 'vitest';
import { FrontmatterValueSuggest } from '../../../src/suggest/FrontmatterValueSuggest';
import { COLOR_VALUES, LINE_STYLE_VALUES } from '../../../src/suggest/ScopeValues';
import { DEFAULT_SETTINGS } from '../../../src/types';

/**
 * The editor's suggest of a scope key's values: offered on the key's line
 * in the frontmatter where the reading of the note finds it, and writing
 * the value alone, the key, its separator and a comment kept as spelled.
 */

/** An editor over `lines`, the cursor at `ch` of line `line` (its end by default). */
function editorOver(lines: string[], line: number, ch = lines[line].length) {
    const doc = [...lines];
    const editor = {
        getLine: (n: number) => doc[n],
        lineCount: () => doc.length,
        replaceRange(text: string, from: { line: number; ch: number }, to: { line: number; ch: number }) {
            const l = doc[from.line];
            doc[from.line] = l.slice(0, from.ch) + text + l.slice(to.ch);
        },
        cursor: null as { line: number; ch: number } | null,
        setCursor(pos: { line: number; ch: number }) { this.cursor = pos; },
    };
    return { editor, cursor: { line, ch }, doc };
}

const plugin = { settings: { ...DEFAULT_SETTINGS } };
const color = new FrontmatterValueSuggest({} as never, plugin as never, COLOR_VALUES);
const lineStyle = new FrontmatterValueSuggest({} as never, plugin as never, LINE_STYLE_VALUES);
const key = DEFAULT_SETTINGS.scopeKeys.color;

/** Pick `value` with the cursor where `at` puts it. */
function pick(suggest: FrontmatterValueSuggest, at: ReturnType<typeof editorOver>, value: string): void {
    const trigger = suggest.onTrigger(at.cursor as never, at.editor as never);
    expect(trigger).not.toBeNull();
    (suggest as unknown as { context: unknown }).context = { editor: at.editor, start: trigger!.start, end: trigger!.end, query: trigger!.query };
    suggest.selectSuggestion(value);
}

describe('FrontmatterValueSuggest', () => {
    it('is offered in the value of its key, with what is typed before the cursor as the query', () => {
        const at = editorOver(['---', `${key}:  bl`, '---', 'body'], 1);
        expect(color.onTrigger(at.cursor as never, at.editor as never)).toEqual({
            start: { line: 1, ch: key.length + 3 }, end: { line: 1, ch: key.length + 5 }, query: 'bl',
        });
    });

    it('is not offered in the key, past the frontmatter, nor where nothing closes the frontmatter', () => {
        const inKey = editorOver(['---', `${key}: red`, '---'], 1, 2);
        expect(color.onTrigger(inKey.cursor as never, inKey.editor as never)).toBeNull();
        const past = editorOver(['---', 'tags: a', '---', `${key}: red`], 3);
        expect(color.onTrigger(past.cursor as never, past.editor as never)).toBeNull();
        const open = editorOver(['---', `${key}: red`, 'body'], 1);
        expect(color.onTrigger(open.cursor as never, open.editor as never)).toBeNull();
    });

    it('is offered where the reading finds the frontmatter: a closing line with spaces after it', () => {
        const at = editorOver(['---', `${key}: re`, '---  ', 'body'], 1);
        expect(color.onTrigger(at.cursor as never, at.editor as never)).not.toBeNull();
    });

    it('writes the value alone: the key, its spacing and a comment stay as spelled', () => {
        const at = editorOver(['---', `${key}  :   bl  # mine`, '---'], 1, key.length + 8);
        pick(color, at, 'blue');
        expect(at.doc[1]).toBe(`${key}  :   blue  # mine`);
        expect(at.editor.cursor).toEqual({ line: 1, ch: key.length + 10 });
    });

    it('replaces a quoted value whole', () => {
        const ls = DEFAULT_SETTINGS.scopeKeys.linestyle;
        const at = editorOver(['---', `${ls}: "da"`, '---'], 1);
        pick(lineStyle, at, 'dashed');
        expect(at.doc[1]).toBe(`${ls}: dashed`);
    });
});
