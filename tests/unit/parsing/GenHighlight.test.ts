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
        expect(paint(['<js>', 'let total = 1 + 2;', '</js>', '- [ ] c'])).toEqual([
            'keyword:let', 'punct:=', 'value:1', 'punct:+', 'value:2', 'punct:;',
        ]);
    });

    it('leaves a local and an unknown name alike, and both unpainted', () => {
        // Only the second is wrong, and the checker already draws under it. A
        // colour here would either repeat that or dress it as something known.
        const painted = paint(['<js>', 'let total = 1', 'const x = nope', '</js>', '- [ ] c']);
        expect(painted.filter(p => p.endsWith(':total') || p.endsWith(':nope') || p.endsWith(':x'))).toEqual([]);
    });

    it('reads a statement word as syntax only where statements are read', () => {
        // The same word in an interpolation is a name: the expression profile
        // has no statements, so painting it as one would be a claim the
        // parser does not make.
        expect(paint(['<js>', 'let of = 1', '</js>', '- [ ] c'])).toContain('keyword:let');
        expect(paint(['- [ ] c ${of}'])).toEqual(['interp:${', 'interp:}']);
    });

    it('names a refused statement as what it is', () => {
        // The rest of the line keeps what was read of it, in both layers: the
        // literal and the bracket are facts about the characters, and a role
        // like `keyword` or `prop` is a claim about the word rather than about
        // the statement that failed around it. `x` is claimed by nobody and
        // stays plain.
        expect(paint(['<js>', 'var x = 1', '</js>', '- [ ] c']))
            .toEqual(['refused:var', 'punct:=', 'value:1']);
        expect(paint(['<js>', 'var start = 1', '</js>', '- [ ] c']))
            .toEqual(['refused:var', 'prop:start', 'punct:=', 'value:1']);
    });

    it('asks about the bracket where the parser asks, not before it', () => {
        // The parser asks about a call twice: once for the built-ins, and much
        // later for a name the block bound. Between them it resolves the words
        // that are values and the words that are properties, so a bracket
        // after one of those does not make it a call.
        expect(paint(['<js>', 'let x = true(1)', '</js>', '- [ ] c']))
            .toContain('value:true');
        expect(paint(['<js>', 'let x = start(1)', '</js>', '- [ ] c']))
            .toContain('prop:start');
        expect(paint(['<js>', 'let x = week(1)', '</js>', '- [ ] c']))
            .toContain('value:week');
        // A name the block bound, called: the parser's last question.
        expect(paint(['<js>', 'const f = x => x', 'const y = f(1)', '</js>', '- [ ] c']))
            .toContain('fn:f');
    });

    it('names a refused expression word, bracket or no bracket', () => {
        // The parser refuses these where they are written, so the bracket
        // after one is not a call. Painted as a call it would say the
        // opposite of the squiggle sitting on the same word.
        for (const word of ['new', 'Date', 'console', 'await', 'typeof', 'delete']) {
            expect(paint(['<js>', `let x = ${word}(1)`, '</js>', '- [ ] c']), word)
                .toContain(`refused:${word}`);
            expect(paint(['<js>', `let x = ${word}`, '</js>', '- [ ] c']), word)
                .toContain(`refused:${word}`);
        }
    });

    it('leaves a built-in alone where it is not called', () => {
        // Bare, the parser reads `format` as a binding like any other name,
        // and the checker calls it unknown. A colour would say otherwise.
        expect(paint(['- [ ] c ${format}'])).toEqual(['interp:${', 'interp:}']);
        expect(paint(['- [ ] c ${format(start, "YYYY")}'])).toContain('fn:format');
    });

    it('reads a template s splices as names, wherever the template is', () => {
        // The splitter reads a template's interpolations in the block profile,
        // so the statement reader is not inside one even in a js section.
        // Painting `of` as syntax there would light up the word the checker is
        // drawing a squiggle under.
        expect(paint(['<js>', 'const s = `x ${of} y`', '</js>', '- [ ] c']))
            .not.toContain('keyword:of');
    });

    it('leaves a cell to its own words, having no colour to add', () => {
        // `state` is a namespace, which this file has never had a role for
        // (the same answer `tv` and `Math` get), and the name after the dot is
        // a member read like any other. What a colour used to say — this one
        // outlives the firing — the text now says.
        expect(paint(['- [ ] c ${state.n}'], CELL_N))
            .toEqual(['interp:${', 'punct:.', 'prop:n', 'interp:}']);
    });

    it('paints a local of the same name as the local it is', () => {
        // A section may declare `n` while the command carries a cell called
        // `n`, and the two have nothing to do with each other any more. The
        // marks say so: nothing on the declaration, and the cell keeps its
        // own two words.
        const lines = ['<js>', 'let n = 1', 'n = n + 1', '</js>', '- [ ] c ${state.n}'];
        expect(parseGenBody(lines, 0, CELL_N).diagnostics).toEqual([]);
        expect(paint(lines, CELL_N).filter(p => p.endsWith(':n')))
            .toEqual(['prop:n']);
    });

    it('paints the name of a call, through a dot or not', () => {
        expect(paint(['- [ ] c ${"a".padStart(2, "0")}'])).toEqual([
            'interp:${', 'string:"a"', 'punct:.', 'fn:padStart', 'punct:(',
            'value:2', 'punct:,', 'string:"0"', 'punct:)', 'interp:}',
        ]);
    });

    it('paints a property of the task, and a member read off one', () => {
        expect(paint(['- [ ] c ${start.weekday()}'])).toEqual([
            'interp:${', 'prop:start', 'punct:.', 'fn:weekday', 'punct:(', 'punct:)', 'interp:}',
        ]);
        expect(paint(['- [ ] c ${file.name}'])).toEqual([
            'interp:${', 'prop:file', 'punct:.', 'prop:name', 'interp:}',
        ]);
    });

    it('paints the literals this language has that JS does not', () => {
        expect(paint(['<js>', 'const d = 2026-08-17', 'const u = 3d', 'const t = 09:30', '</js>', '- [ ] c']))
            .toEqual([
                'keyword:const', 'punct:=', 'temporal:2026-08-17',
                'keyword:const', 'punct:=', 'temporal:3d',
                'keyword:const', 'punct:=', 'temporal:09:30',
            ]);
        expect(paint(['- [ ] c ${[[A Note]]}'])).toEqual(['interp:${', 'link:[[A Note]]', 'interp:}']);
    });

    it('paints a value word the parser resolves before any binding', () => {
        expect(paint(['- [ ] c ${startOf(week)}'])).toEqual([
            'interp:${', 'fn:startOf', 'punct:(', 'value:week', 'punct:)', 'interp:}',
        ]);
        expect(paint(['- [ ] c ${true}'])).toEqual(['interp:${', 'value:true', 'interp:}']);
    });

    it('paints a comment, which only a block may carry', () => {
        expect(paint(['<js>', 'let x = 1 // why', '</js>', '- [ ] c']))
            .toEqual(['keyword:let', 'punct:=', 'value:1', 'comment:// why']);
    });

    it('says where an interpolation opens even when its expression does not parse', () => {
        // The line the marks are least able to describe is the line being
        // repaired, and it is the one a reader most needs described: without
        // the seam, the brace of a broken splice is prose like any other
        // character. The words inside are read from the token stream, so they
        // say what they say in a section — no more.
        const lines = ['- [ ] c ${typeof n}'];
        expect(parseGenBody(lines, 0, undefined).diagnostics.map(d => d.code)).toContain('expr.no-typeof');
        expect(paint(lines)).toEqual(['interp:${', 'refused:typeof', 'interp:}']);
        expect(paint(['- [ ] c ${1 +}'])).toEqual(['interp:${', 'value:1', 'punct:+', 'interp:}']);
    });

    it('paints a refused word the same on either surface', () => {
        // A section is read from its source and a body line was read from its
        // parts, so the same word used to be `refused` in one place and plain
        // in the other. What a word is cannot depend on which reader reached
        // it first.
        expect(paint(['<js>', 'let x = typeof n', '</js>', '- [ ] c'])).toContain('refused:typeof');
        expect(paint(['- [ ] c ${typeof n}'])).toContain('refused:typeof');
    });

    it('says only that an unclosed interpolation opened', () => {
        // How far it reaches is not decided — the closing brace is what would
        // decide it — so the opening is the whole of what is known, and the
        // diagnostic sits on the same characters.
        const lines = ['- [ ] c ${format('];
        expect(parseGenBody(lines, 0, undefined).diagnostics.map(d => d.code))
            .toContain('gen.unterminated-interpolation');
        expect(paint(lines)).toEqual(['interp:${']);
    });

    it('reads a template s braces by the same rule as a line s', () => {
        // Both ask the splitter where an interpolation begins, so the
        // backslash means the same thing in both places. The template runs as
        // text either way; what changes is whether a seam is claimed inside
        // it.
        expect(paint(['- [ ] c ${`a \\${n} b`}'], CELL_N)).toEqual([
            'interp:${', 'string:`a \\${n} b`', 'interp:}',
        ]);
    });

    it('leaves an escaped brace alone, since no interpolation opens there', () => {
        // The backslash is the one thing this language reads in a body line,
        // and what follows it is text. A seam here would be an interpolation
        // the engine never saw.
        expect(paint(['- [ ] c \\${n}'], CELL_N)).toEqual([]);
    });

    it('tells the seam of an interpolation from the punctuation inside it', () => {
        // The braces are the one symbol in a body line that says where this
        // language starts, and the brackets and commas inside say what any
        // bracket says anywhere. Two roles, because a reader of these marks is
        // entitled to know which is which — whether the editor paints them the
        // same colour is a question for the editor.
        expect(paint(['- [ ] c ${format(start, "YYYY")}'])).toEqual([
            'interp:${', 'fn:format', 'punct:(', 'prop:start', 'punct:,',
            'string:"YYYY"', 'punct:)', 'interp:}',
        ]);
    });

    it('runs a template as text, and what is spliced into it again inside', () => {
        expect(paint(['- [ ] c ${`n is ${state.n}`}'], CELL_N)).toEqual([
            'interp:${', 'string:`n is ${state.n}`',
            'interp:${', 'punct:.', 'prop:n', 'interp:}', 'interp:}',
        ]);
    });

    it('measures a child line from the start of the line it was written on', () => {
        // The parts carry the indent, so a mark on an indented line has to
        // point past it. Reading the text back is what proves it.
        expect(paint(['- [ ] parent', '    - [ ] child ${state.n}'], CELL_N))
            .toEqual(['interp:${', 'punct:.', 'prop:n', 'interp:}']);
    });

    it('puts every mark of a section on the line it was written on', () => {
        const lines = ['<js>', 'let a = 1', 'let b = 2', '</js>', '- [ ] c'];
        const marks = highlightGenBody(parseGenBody(lines, 0, undefined));
        expect(marks.filter(m => m.role === 'keyword').map(m => m.line)).toEqual([1, 2]);
    });

    it('leaves both namespaces alone, since there is no role for one', () => {
        // `Math` and `tv` are resolved by the parser, but neither is a
        // property, a value or a call — and inventing a role for them would be
        // a claim these roles do not carry. Both or neither; neither.
        expect(paint(['- [ ] c ${Math.floor(1.5)}'])).toEqual([
            'interp:${', 'punct:.', 'fn:floor', 'punct:(', 'value:1.5', 'punct:)', 'interp:}',
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
        expect(paint(['<js>', 'const f = x => x', 'let y = f(1)', '</js>', '- [ ] c']))
            .toContain('fn:f');
        expect(paint(['<js>', 'const f = x => x', 'let y = f', '(1)', '</js>', '- [ ] c']))
            .not.toContain('fn:f');
    });

    it('says nothing about a line that is only prose', () => {
        expect(paint(['- [ ] just words, and a $ sign'])).toEqual([]);
    });
});
