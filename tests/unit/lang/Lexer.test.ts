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
});
