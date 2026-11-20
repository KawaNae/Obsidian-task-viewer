import { describe, expect, it } from 'vitest';
import { MARKED_LINES, confirms, markLines, markedLine, turnLine } from '../../../src/services/data/FrameCheckboxes';

/** The character `markLines` writes for the line `k`. */
const mark = (k: number) => String.fromCharCode(0xE000 + k);

describe('markLines', () => {
    it("replaces each task line's status by the character naming its line, and leaves the other lines", () => {
        expect(markLines('# h\n- [ ] a\ntext\n- [x] b')).toBe(`# h\n- [${mark(1)}] a\ntext\n- [${mark(3)}] b`);
    });

    it('reaches the status past quotes, footnote definitions and list markers on the same line, and past markers of any number', () => {
        const md = [
            '> - [ ] a',
            '>   > 1. [/] b',
            '[^1]: - [ ] c',
            '> [^q]: - [-] d',
            '- - [ ] e',
            '1. - [x] f',
            '- 1) [ ] g',
            '1234567890. [ ] h',
            '\t* [?] i',
            '+ [ ] j',
        ];
        expect(markLines(md.join('\n')).split('\n')).toEqual(md.map((line, k) => line.replace(/\[.\]/, `[${mark(k)}]`)));
    });

    it('takes any one character as the status, a bracket and a backslash too', () => {
        expect(markLines('- []] a\n- [\\] b')).toBe(`- [${mark(0)}] a\n- [${mark(1)}] b`);
    });

    it('replaces no status of a line not written as a task line', () => {
        const md = '-[ ] b\n[ ] c\n- [  ] d\n- [] e\ntext - [ ] f';
        expect(markLines(md)).toBe(md);
    });

    it("replaces the language of each fence's opening line, past what holds it, and of no other line", () => {
        const md = '```dataviewjs\nrun()\n```\n- ```dataview\n  TASK\n  ```\n> ~~~ tasks\n> q\n> ~~~\n```\nplain\n```\n`code`';
        expect(markLines(md)).toBe('```x\nrun()\n```\n- ```x\n  TASK\n  ```\n> ~~~ x\n> q\n> ~~~\n```\nplain\n```\n`code`');
    });

    it('makes each embed a link, of a note and of a file, in a quote and an item', () => {
        const md = [
            '![[Other#Tasks]]',
            '> ![[Other]]',
            '- [ ] wow![[x]] and ![[y|z]]',
            '- [ ] a ![alt](b.png) c',
            '![](note.md)',
            '> - ![[Other#^b]]',
        ];
        expect(markLines(md.join('\n')).split('\n')).toEqual([
            '[[Other#Tasks]]',
            '> [[Other]]',
            `- [${mark(2)}] wow[[x]] and [[y|z]]`,
            `- [${mark(3)}] a [alt](b.png) c`,
            '[](note.md)',
            '> - [[Other#^b]]',
        ]);
    });

    it("leaves an ! that makes no embed, and a task line's status of !", () => {
        expect(markLines('- [!] a\n> [!todo] b\n- ![ ] c\nwow! [x]\n- [!][[x]] d').split('\n')).toEqual([
            `- [${mark(0)}] a`,
            '> [!todo] b',
            '- ![ ] c',
            'wow! [x]',
            `- [${mark(4)}][[x]] d`,
        ]);
    });

    it(`names no line past the first ${MARKED_LINES}`, () => {
        const md = Array.from({ length: MARKED_LINES + 1 }, () => '- [ ] a').join('\n');
        const lines = markLines(md).split('\n');
        expect(lines[MARKED_LINES - 1]).toBe(`- [${mark(MARKED_LINES - 1)}] a`);
        expect(lines[MARKED_LINES]).toBe('- [ ] a');
    });
});

describe('markedLine', () => {
    it('reads the line a character of markLines names', () => {
        expect(markedLine(mark(0))).toBe(0);
        expect(markedLine(mark(MARKED_LINES - 1))).toBe(MARKED_LINES - 1);
    });

    it('reads no line from a status, nothing, or a character outside those naming lines', () => {
        for (const task of [null, '', 'x', ' ', String.fromCharCode(0xDFFF), String.fromCharCode(0xF900), mark(1) + mark(2)]) {
            expect(markedLine(task)).toBeNull();
        }
    });
});

describe('turnLine', () => {
    it("turns the status of a checkbox drawn with none to x, in the markdown to render and in the note's line to write", () => {
        expect(turnLine('# h\n- [ ] a\n- [ ] b', [4, 5, 6], 2, '')).toEqual({
            markdown: '# h\n- [ ] a\n- [x] b',
            drawn: 'x',
            write: { line: 6, text: '- [ ] b', next: '- [x] b' },
        });
    });

    it('turns a blank other than a space, which the render draws as no status, to x too', () => {
        for (const status of ['\t', '\u00A0', '\u3000']) {
            const turned = turnLine(`- [${status}] a`, [0], 0, '')!;
            expect(turned.write.next).toBe('- [x] a');
            expect(turned.drawn).toBe('x');
        }
    });

    it('turns the status of a checkbox drawn with one to a space, drawn as nothing', () => {
        for (const status of ['x', 'X', '/', '-', ']', '\\']) {
            const turned = turnLine(`> - [${status}] a`, [0], 0, status)!;
            expect(turned.write.next).toBe('> - [ ] a');
            expect(turned.drawn).toBe('');
        }
    });

    it("turns the status of the line alone, not a bracket further on, and replaces the fences' languages", () => {
        expect(turnLine('- [ ] a [x] b\n```dataviewjs\n```', [0, 1, 2], 0, '')!.markdown).toBe('- [x] a [x] b\n```x\n```');
    });

    it("makes the embeds links in the markdown to render, the turned line's too, and writes the note's line as it reads", () => {
        expect(turnLine('- [ ] a ![[n]]\n![](m.md)', [3, 4], 0, '')).toEqual({
            markdown: '- [x] a [[n]]\n[](m.md)',
            drawn: 'x',
            write: { line: 3, text: '- [ ] a ![[n]]', next: '- [x] a ![[n]]' },
        });
    });

    it('gives nothing for a line not written as a task line, nor one past the markdown', () => {
        expect(turnLine('text\n- [ ] a', [0, 1], 0, '')).toBeNull();
        expect(turnLine('- [ ] a', [0], 1, '')).toBeNull();
    });
});

describe('confirms', () => {
    it("holds when the pressed checkbox's status is turned and every other is as shown", () => {
        expect(confirms(['', 'x', ''], ['', 'x', 'x'], 2, 'x')).toBe(true);
        expect(confirms(['', 'x', ''], ['', '', ''], 1, '')).toBe(true);
    });

    it('does not hold when another checkbox changed, the pressed one did not, or the checkboxes are not as many', () => {
        expect(confirms(['', ''], ['x', 'x'], 1, 'x')).toBe(false);
        expect(confirms(['', ''], ['', ''], 1, 'x')).toBe(false);
        expect(confirms(['', ''], ['', 'x', ''], 1, 'x')).toBe(false);
        expect(confirms(['', ''], [''], 0, 'x')).toBe(false);
        expect(confirms([], [], 0, 'x')).toBe(false);
    });

    it('does not hold when the render draws fewer checkboxes, though the pressed one and every one before it are as asked', () => {
        // A checkbox drawn only as the card is shown (by an inline query) leaves the render one short.
        expect(confirms(['', '', ''], ['', 'x'], 1, 'x')).toBe(false);
        expect(confirms(['', 'x', ''], ['x'], 0, 'x')).toBe(false);
    });

    it('does not hold when the render draws more checkboxes than the card shows', () => {
        expect(confirms(['', 'x'], ['', '', 'x'], 1, '')).toBe(false);
    });

    it('does not hold when the pressed checkbox shows the status already: a line drawn nowhere was turned', () => {
        expect(confirms(['x', ''], ['x', ''], 0, 'x')).toBe(false);
    });

    it('does not hold for a checkbox written as HTML whose status names the line of a task line below it', () => {
        // `<ul><li data-task="M"><input type="checkbox" class="task-list-item-checkbox"> a</li></ul>`, then
        // `- [M] b` and `- [ ] c`, M being the character naming line 2: the render of markLines draws M on
        // the HTML item too, so it names line 2, the line of b. Turning line 2 turns b's checkbox, not a's.
        const shown = [mark(2), mark(2), ''];
        const turned = turnLine(`<ul><li data-task="${mark(2)}"><input type="checkbox" class="task-list-item-checkbox"> a</li></ul>\n\n- [${mark(2)}] b\n- [ ] c`, [0, 1, 2, 3], markedLine(mark(2))!, shown[0])!;
        expect(turned.write.text).toBe(`- [${mark(2)}] b`);
        const tried = [mark(2), '', ''];
        expect(confirms(shown, tried, 0, turned.drawn)).toBe(false);
        expect(confirms(shown, tried, 1, turned.drawn)).toBe(true);
    });
});
