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
    const marks = highlightGenBody(parseGenBody(lines, 0, cells), cells);
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
        // The rest of the line keeps what the lexer read of it. A literal and
        // a bracket are facts about the characters; only the roles that took a
        // parser to decide are withheld where the parser refused — `x` binds
        // nothing here, and is left alone.
        expect(paint(['<js', 'var x = 1', '/js>', '- [ ] c']))
            .toEqual(['refused:var', 'punct:=', 'value:1']);
    });

    it('paints a cell as state, and its type comes from the command', () => {
        expect(paint(['- [ ] c ${n}'], CELL_N)).toEqual(['punct:${', 'cell:n', 'punct:}']);
    });

    it('stops painting a cell the block declares for itself', () => {
        // The declaration hides it and the writes stop carrying, which the
        // checker says out loud. The colour has to agree with the warning.
        const lines = ['<js', 'let n = 1', 'n = n + 1', '/js>', '- [ ] c ${n}'];
        expect(parseGenBody(lines, 0, CELL_N).diagnostics.map(d => d.code)).toContain('stmt.shadows-cell');
        expect(paint(lines, CELL_N).filter(p => p.startsWith('cell:'))).toEqual([]);
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

    it('says nothing about a line that is only prose', () => {
        expect(paint(['- [ ] just words, and a $ sign'])).toEqual([]);
    });
});
