import { describe, it, expect } from 'vitest';
import { tokenize, splitDurationText } from '../../../src/services/lang/Lexer';
import { TokenKind } from '../../../src/services/lang/Token';

function kinds(src: string): TokenKind[] {
    return tokenize(src).tokens.map(t => t.kind);
}

function texts(src: string): string[] {
    return tokenize(src).tokens.filter(t => t.kind !== 'eof').map(t => t.text);
}

describe('Lexer', () => {
    it('lexes flow-shaped input into head-led tokens', () => {
        expect(kinds('every tue,fri x14 until 2026-09-28')).toEqual([
            'ident', 'ident', 'comma', 'ident', 'ident', 'ident', 'date', 'eof',
        ]);
    });

    it('lexes durations as single tokens', () => {
        const { tokens } = tokenize('3d 30min 2mo 1y');
        expect(tokens.map(t => t.kind)).toEqual(['duration', 'duration', 'duration', 'duration', 'eof']);
        expect(splitDurationText(tokens[1].text)).toEqual({ amount: 30, unit: 'min' });
        expect(splitDurationText(tokens[2].text)).toEqual({ amount: 2, unit: 'mo' });
    });

    it('prefers datetime > date > time > duration > number', () => {
        expect(kinds('2026-07-15T14:00')).toEqual(['datetime', 'eof']);
        expect(kinds('2026-07-15')).toEqual(['date', 'eof']);
        expect(kinds('14:00')).toEqual(['time', 'eof']);
        expect(kinds('14')).toEqual(['number', 'eof']);
    });

    it('lexes +3d as plus followed by duration', () => {
        expect(kinds('+3d')).toEqual(['plus', 'duration', 'eof']);
    });

    it('lexes x14 as a single ident (flow parser splits it)', () => {
        expect(kinds('x14')).toEqual(['ident', 'eof']);
    });

    it('lexes mo@25 as ident, at, number', () => {
        expect(kinds('mo@25')).toEqual(['ident', 'at', 'number', 'eof']);
    });

    it('decodes strings with escapes', () => {
        expect(texts('"a \\"b\\" \\\\ c"')).toEqual(['a "b" \\ c']);
    });

    it('reports unterminated strings', () => {
        const { diagnostics } = tokenize('"abc');
        expect(diagnostics.some(d => d.code === 'lex.unterminated-string')).toBe(true);
    });

    it('strips wikilink brackets', () => {
        const { tokens } = tokenize('move([[Archive/Done]])');
        expect(tokens.map(t => t.kind)).toEqual(['ident', 'lparen', 'wikilink', 'rparen', 'eof']);
        expect(tokens[2].text).toBe('Archive/Done');
    });

    it('reports unterminated wikilinks', () => {
        const { diagnostics } = tokenize('[[Archive');
        expect(diagnostics.some(d => d.code === 'lex.unterminated-wikilink')).toBe(true);
    });

    it('lexes comparison and logic operators', () => {
        expect(kinds('a == b != c <= d >= e && f || !g')).toEqual([
            'ident', 'eq', 'ident', 'neq', 'ident', 'lte', 'ident', 'gte',
            'ident', 'ampamp', 'ident', 'pipepipe', 'bang', 'ident', 'eof',
        ]);
    });

    it('reports unknown duration units', () => {
        const { diagnostics } = tokenize('3x');
        expect(diagnostics.some(d => d.code === 'lex.unknown-unit')).toBe(true);
    });

    it('records spans as source offsets', () => {
        const { tokens } = tokenize('every mon');
        expect(tokens[0]).toMatchObject({ text: 'every', start: 0, end: 5 });
        expect(tokens[1]).toMatchObject({ text: 'mon', start: 6, end: 9 });
    });

    // 文の終端は改行そのもの（ASI はしない）。どの改行がトークンになるかは
    // 「いま開いている一番内側の括弧」だけで決まる。
    describe('newline tokens', () => {
        it('emits a newline at the top level', () => {
            expect(kinds('a\nb')).toEqual(['ident', 'newline', 'ident', 'eof']);
        });

        it('holds the line inside an open ( or [', () => {
            expect(kinds('(a\nb)')).toEqual(['lparen', 'ident', 'ident', 'rparen', 'eof']);
            expect(kinds('[a\nb]')).toEqual(['lbracket', 'ident', 'ident', 'rbracket', 'eof']);
        });

        it('resumes emitting once the bracket closes', () => {
            expect(kinds('(a\nb)\nc')).toEqual([
                'lparen', 'ident', 'ident', 'rparen', 'newline', 'ident', 'eof',
            ]);
        });

        it('emits inside a brace, which is where statements live', () => {
            expect(kinds('{a\nb}')).toEqual(['lbrace', 'ident', 'newline', 'ident', 'rbrace', 'eof']);
        });

        // スカラーの深さでは表せない形: 呼び出しの内側のブロック本体。
        // 判定は最上段だけなので、( の中でも { が開けば改行は戻ってくる。
        it('emits inside a brace nested in parens', () => {
            expect(kinds('f({a\nb})')).toEqual([
                'ident', 'lparen', 'lbrace', 'ident', 'newline', 'ident', 'rbrace', 'rparen', 'eof',
            ]);
        });

        it('holds the line again inside a bracket nested in a brace', () => {
            expect(kinds('{[a\nb]}')).toEqual([
                'lbrace', 'lbracket', 'ident', 'ident', 'rbracket', 'rbrace', 'eof',
            ]);
        });

        it('keeps a line break inside a template literal in the token', () => {
            const { tokens } = tokenize('`a\nb`');
            expect(tokens.map(t => t.kind)).toEqual(['template', 'eof']);
            expect(tokens[0].text).toBe('a\nb');
        });

        it('leaves a stray closer alone rather than unbalancing the stack', () => {
            expect(kinds(')\na')).toEqual(['rparen', 'newline', 'ident', 'eof']);
        });
    });

    describe('comments', () => {
        it('drops a // comment and records where it was', () => {
            const { tokens, comments } = tokenize('a // note');
            expect(tokens.map(t => t.kind)).toEqual(['ident', 'eof']);
            expect(comments).toEqual([{ start: 2, end: 9 }]);
        });

        it('leaves the line break for the boundary rule', () => {
            expect(kinds('a // note\nb')).toEqual(['ident', 'newline', 'ident', 'eof']);
        });

        it('does not read a // inside a string or a wikilink', () => {
            expect(tokenize('"a // b"').comments).toEqual([]);
            expect(tokenize('[[a//b]]').comments).toEqual([]);
        });

        it('still lexes a lone slash as division', () => {
            expect(kinds('6 / 3')).toEqual(['number', 'slash', 'number', 'eof']);
        });

        it('refuses a block comment, which could hide a line break', () => {
            const { diagnostics } = tokenize('a /* b */ c');
            expect(diagnostics.map(d => d.code)).toEqual(['lex.no-block-comment']);
        });

        it('shifts comment spans by the base offset, like diagnostics', () => {
            expect(tokenize('a // note', 10).comments).toEqual([{ start: 12, end: 19 }]);
        });
    });
});
