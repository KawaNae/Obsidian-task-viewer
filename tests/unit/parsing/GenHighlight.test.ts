import { describe, it, expect } from 'vitest';
import { parseGenBody } from '../../../src/services/parsing/gen/GenBodyParser';
import { highlightGenBody } from '../../../src/services/parsing/gen/GenHighlight';
import type { StaticType } from '../../../src/services/lang/functions';

/**
 * What the editor is told a block's source is.
 *
 * Every assertion reads the marks back off the lines they were measured
 * against, so a column that points at the wrong character cannot pass: the
 * expectation names the text under the mark, not the numbers.
 */
function paint(lines: string[], cells?: Map<string, StaticType>): string[] {
    const marks = highlightGenBody(parseGenBody(lines, 0, cells));
    return marks.map(m => `${m.role}:${lines[m.line].slice(m.from, m.to)}`);
}

const CELL_N = new Map<string, StaticType>([['n', 'number']]);

describe('what a block is made of, said in the engine s own terms', () => {
    it('paints a statement by what the statement reader does with each word', () => {
        expect(paint(['<js', 'let total = 1 + 2;', '/js>', '- [ ] c'])).toEqual([
            'keyword:let', 'punct:=', 'value:1', 'punct:+', 'value:2', 'punct:;',
        ]);
    });

    it('leaves a local and an unknown name alike, and both unpainted', () => {
        // Only the second is wrong, and the checker already draws under it. A
        // colour here would either repeat that or dress it as something known.
        const painted = paint(['<js', 'let total = 1', 'const x = nope', '/js>', '- [ ] c']);
        expect(painted.filter(p => p.endsWith(':total') || p.endsWith(':nope') || p.endsWith(':x'))).toEqual([]);
    });

    it('reads a statement word as syntax only where statements are read', () => {
        // The same word in an interpolation is a name: the expression profile
        // has no statements, so painting it as one would be a claim the
        // parser does not make.
        expect(paint(['<js', 'let of = 1', '/js>', '- [ ] c'])).toContain('keyword:let');
        expect(paint(['- [ ] c ${of}'])).toEqual(['punct:${', 'punct:}']);
    });

    it('names a refused statement as what it is', () => {
        // The rest of the line keeps what was read of it, in both layers: the
        // literal and the bracket are facts about the characters, and a role
        // like `keyword` or `prop` is a claim about the word rather than about
        // the statement that failed around it. `x` is claimed by nobody and
        // stays plain.
        expect(paint(['<js', 'var x = 1', '/js>', '- [ ] c']))
            .toEqual(['refused:var', 'punct:=', 'value:1']);
        expect(paint(['<js', 'var start = 1', '/js>', '- [ ] c']))
            .toEqual(['refused:var', 'prop:start', 'punct:=', 'value:1']);
    });

    it('asks about the bracket where the parser asks, not before it', () => {
        // The parser asks about a call twice: once for the built-ins, and much
        // later for a name the block bound. Between them it resolves the words
        // that are values and the words that are properties, so a bracket
        // after one of those does not make it a call.
        expect(paint(['<js', 'let x = true(1)', '/js>', '- [ ] c']))
            .toContain('value:true');
        expect(paint(['<js', 'let x = start(1)', '/js>', '- [ ] c']))
            .toContain('prop:start');
        expect(paint(['<js', 'let x = week(1)', '/js>', '- [ ] c']))
            .toContain('value:week');
        // A name the block bound, called: the parser's last question.
        expect(paint(['<js', 'const f = x => x', 'const y = f(1)', '/js>', '- [ ] c']))
            .toContain('fn:f');
    });

    it('names a refused expression word, bracket or no bracket', () => {
        // The parser refuses these where they are written, so the bracket
        // after one is not a call. Painted as a call it would say the
        // opposite of the squiggle sitting on the same word.
        for (const word of ['new', 'Date', 'console', 'await', 'typeof', 'delete']) {
            expect(paint(['<js', `let x = ${word}(1)`, '/js>', '- [ ] c']), word)
                .toContain(`refused:${word}`);
            expect(paint(['<js', `let x = ${word}`, '/js>', '- [ ] c']), word)
                .toContain(`refused:${word}`);
        }
    });

    it('leaves a built-in alone where it is not called', () => {
        // Bare, the parser reads `format` as a binding like any other name,
        // and the checker calls it unknown. A colour would say otherwise.
        expect(paint(['- [ ] c ${format}'])).toEqual(['punct:${', 'punct:}']);
        expect(paint(['- [ ] c ${format(start, "YYYY")}'])).toContain('fn:format');
    });

    it('reads a template s splices as names, wherever the template is', () => {
        // The splitter reads a template's interpolations in the block profile,
        // so the statement reader is not inside one even in a js section.
        // Painting `of` as syntax there would light up the word the checker is
        // drawing a squiggle under.
        expect(paint(['<js', 'const s = `x ${of} y`', '/js>', '- [ ] c']))
            .not.toContain('keyword:of');
    });

    it('paints a cell as state, and its type comes from the command', () => {
        expect(paint(['- [ ] c ${n}'], CELL_N)).toEqual(['punct:${', 'cell:n', 'punct:}']);
    });

    it('stops painting a cell the section declares for itself', () => {
        // The declaration hides it and the writes stop carrying, which the
        // checker says out loud. The colour has to agree with the warning.
        const lines = ['<js', 'let n = 1', 'n = n + 1', '/js>', '- [ ] c ${n}'];
        expect(parseGenBody(lines, 0, CELL_N).diagnostics.map(d => d.code)).toContain('stmt.shadows-cell');
        expect(paint(lines, CELL_N).filter(p => p.startsWith('cell:'))).toEqual([]);
    });

    it('keeps painting a cell that is hidden only inside a block', () => {
        // The warning says a name was hidden but not where, and a name hidden
        // inside an `if` is the cell again on the way out. What the body
        // resolves is what the bindings say, so that is what is read.
        const lines = ['<js', 'if (true) { let n = 0 }', '/js>', '- [ ] c ${n}'];
        expect(parseGenBody(lines, 0, CELL_N).diagnostics.map(d => d.code)).toContain('stmt.shadows-cell');
        expect(paint(lines, CELL_N)).toContain('cell:n');
    });

    it('paints the name of a call, through a dot or not', () => {
        expect(paint(['- [ ] c ${"a".padStart(2, "0")}'])).toEqual([
            'punct:${', 'string:"a"', 'punct:.', 'fn:padStart', 'punct:(',
            'value:2', 'punct:,', 'string:"0"', 'punct:)', 'punct:}',
        ]);
    });

    it('paints a property of the task, and a member read off one', () => {
        expect(paint(['- [ ] c ${start.weekday()}'])).toEqual([
            'punct:${', 'prop:start', 'punct:.', 'fn:weekday', 'punct:(', 'punct:)', 'punct:}',
        ]);
        expect(paint(['- [ ] c ${file.name}'])).toEqual([
            'punct:${', 'prop:file', 'punct:.', 'prop:name', 'punct:}',
        ]);
    });

    it('paints the literals this language has that JS does not', () => {
        expect(paint(['<js', 'const d = 2026-08-17', 'const u = 3d', 'const t = 09:30', '/js>', '- [ ] c']))
            .toEqual([
                'keyword:const', 'punct:=', 'temporal:2026-08-17',
                'keyword:const', 'punct:=', 'temporal:3d',
                'keyword:const', 'punct:=', 'temporal:09:30',
            ]);
        expect(paint(['- [ ] c ${[[A Note]]}'])).toEqual(['punct:${', 'link:[[A Note]]', 'punct:}']);
    });

    it('paints a value word the parser resolves before any binding', () => {
        expect(paint(['- [ ] c ${startOf(week)}'])).toEqual([
            'punct:${', 'fn:startOf', 'punct:(', 'value:week', 'punct:)', 'punct:}',
        ]);
        expect(paint(['- [ ] c ${true}'])).toEqual(['punct:${', 'value:true', 'punct:}']);
    });

    it('paints a comment, which only a block may carry', () => {
        expect(paint(['<js', 'let x = 1 // why', '/js>', '- [ ] c']))
            .toEqual(['keyword:let', 'punct:=', 'value:1', 'comment:// why']);
    });

    it('runs a template as text, and what is spliced into it again inside', () => {
        expect(paint(['- [ ] c ${`n is ${n}`}'], CELL_N)).toEqual([
            'punct:${', 'string:`n is ${n}`', 'punct:${', 'cell:n', 'punct:}', 'punct:}',
        ]);
    });

    it('measures a child line from the start of the line it was written on', () => {
        // The parts carry the indent, so a mark on an indented line has to
        // point past it. Reading the text back is what proves it.
        expect(paint(['- [ ] parent', '    - [ ] child ${n}'], CELL_N))
            .toEqual(['punct:${', 'cell:n', 'punct:}']);
    });

    it('puts every mark of a section on the line it was written on', () => {
        const lines = ['<js', 'let a = 1', 'let b = 2', '/js>', '- [ ] c'];
        const marks = highlightGenBody(parseGenBody(lines, 0, undefined));
        expect(marks.filter(m => m.role === 'keyword').map(m => m.line)).toEqual([1, 2]);
    });

    it('leaves both namespaces alone, since there is no role for one', () => {
        // `Math` and `tv` are resolved by the parser, but neither is a
        // property, a value or a call — and inventing a role for them would be
        // a claim these roles do not carry. Both or neither; neither.
        expect(paint(['- [ ] c ${Math.floor(1.5)}'])).toEqual([
            'punct:${', 'punct:.', 'fn:floor', 'punct:(', 'value:1.5', 'punct:)', 'punct:}',
        ]);
        expect(paint(['- [ ] c ${tv.date.format(start, "YYYY")}'])
            .filter(p => p.endsWith(':tv') || p.endsWith(':Math'))).toEqual([]);
    });

    it('reads the bracket as the parser does when a line break is between', () => {
        // Both readers walk the same token stream, and in a section a line
        // break is a token there. Neither sees a call across one.
        //
        // Measured on a name the block bound, since that is the only role the
        // bracket decides on its own — a built-in reads the same either way,
        // so it would prove nothing here.
        expect(paint(['<js', 'const f = x => x', 'let y = f(1)', '/js>', '- [ ] c']))
            .toContain('fn:f');
        expect(paint(['<js', 'const f = x => x', 'let y = f', '(1)', '/js>', '- [ ] c']))
            .not.toContain('fn:f');
    });

    it('says nothing about a line that is only prose', () => {
        expect(paint(['- [ ] just words, and a $ sign'])).toEqual([]);
    });
});
