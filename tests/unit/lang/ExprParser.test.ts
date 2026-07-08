import { describe, it, expect } from 'vitest';
import { Diagnostic } from '../../../src/services/lang/Diagnostic';
import { Expr } from '../../../src/services/lang/ExprAst';
import { parseExpr } from '../../../src/services/lang/ExprParser';
import { tokenize } from '../../../src/services/lang/Lexer';
import { TokenCursor } from '../../../src/services/lang/Token';

function parse(src: string): { expr: Expr | null; diagnostics: Diagnostic[] } {
    const { tokens, diagnostics } = tokenize(src);
    const cursor = new TokenCursor(tokens);
    const expr = parseExpr(cursor, diagnostics);
    return { expr, diagnostics };
}

describe('ExprParser', () => {
    it('parses literals', () => {
        expect(parse('2026-07-15').expr).toMatchObject({ kind: 'lit', value: { type: 'date', value: '2026-07-15' } });
        expect(parse('2026-07-15T14:00').expr).toMatchObject({ kind: 'lit', value: { type: 'datetime', date: '2026-07-15', time: '14:00' } });
        expect(parse('3d').expr).toMatchObject({ kind: 'lit', value: { type: 'duration', amount: 3, unit: 'd' } });
        expect(parse('"abc"').expr).toMatchObject({ kind: 'lit', value: { type: 'string', value: 'abc' } });
        expect(parse('42').expr).toMatchObject({ kind: 'lit', value: { type: 'number', value: 42 } });
        expect(parse('true').expr).toMatchObject({ kind: 'lit', value: { type: 'bool', value: true } });
        expect(parse('tue').expr).toMatchObject({ kind: 'lit', value: { type: 'weekday', value: 2 } });
        expect(parse('[[Archive]]').expr).toMatchObject({ kind: 'lit', value: { type: 'link', target: 'Archive' } });
        expect(parse('none').expr).toMatchObject({ kind: 'lit', value: { type: 'none' } });
    });

    it('normalizes H:mm time literals', () => {
        expect(parse('9:30').expr).toMatchObject({ kind: 'lit', value: { type: 'time', value: '09:30' } });
    });

    it('parses property references', () => {
        expect(parse('start').expr).toMatchObject({ kind: 'prop', name: 'start' });
        expect(parse('file.name').expr).toMatchObject({ kind: 'prop', name: 'file.name' });
    });

    it('parses date arithmetic with precedence', () => {
        const { expr } = parse('start + 3d');
        expect(expr).toMatchObject({
            kind: 'binary', op: '+',
            left: { kind: 'prop', name: 'start' },
            right: { kind: 'lit', value: { type: 'duration', amount: 3, unit: 'd' } },
        });
    });

    it('binds comparison looser than addition', () => {
        const { expr } = parse('start + 3d < due');
        expect(expr).toMatchObject({
            kind: 'binary', op: '<',
            left: { kind: 'binary', op: '+' },
            right: { kind: 'prop', name: 'due' },
        });
    });

    it('binds && tighter than ||', () => {
        const { expr } = parse('true || false && true');
        expect(expr).toMatchObject({
            kind: 'binary', op: '||',
            right: { kind: 'binary', op: '&&' },
        });
    });

    it('parses ternary at lowest precedence', () => {
        const { expr } = parse('start < due ? start : due');
        expect(expr).toMatchObject({
            kind: 'cond',
            cond: { kind: 'binary', op: '<' },
            then: { kind: 'prop', name: 'start' },
            else: { kind: 'prop', name: 'due' },
        });
    });

    it('parses function calls with expression arguments', () => {
        const { expr } = parse('format(start + 1w, "MM/DD")');
        expect(expr).toMatchObject({
            kind: 'call', fn: 'format',
            args: [{ kind: 'binary', op: '+' }, { kind: 'lit', value: { type: 'string', value: 'MM/DD' } }],
        });
    });

    it('parses time() function call', () => {
        const { expr, diagnostics } = parse('time(start)');
        expect(diagnostics).toEqual([]);
        expect(expr).toMatchObject({ kind: 'call', fn: 'time', args: [{ kind: 'prop', name: 'start' }] });
    });

    it('parses nested calls', () => {
        const { expr } = parse('startOf(next(mo), week)');
        // 'mo' is not a weekday; expect an unknown identifier diagnostic instead
        expect(expr).toBeNull();
    });

    it('parses startOf with unit keyword and nested next()', () => {
        const { expr, diagnostics } = parse('startOf(week, next(tue))');
        expect(diagnostics).toEqual([]);
        expect(expr).toMatchObject({
            kind: 'call', fn: 'startOf',
            args: [
                { kind: 'lit', value: { type: 'string', value: 'week' } },
                { kind: 'call', fn: 'next', args: [{ kind: 'lit', value: { type: 'weekday', value: 2 } }] },
            ],
        });
    });

    it('parses parenthesized expressions', () => {
        const { expr } = parse('(start + 1d) + 2d');
        expect(expr).toMatchObject({ kind: 'binary', op: '+', left: { kind: 'binary', op: '+' } });
    });

    it('reports unknown identifiers', () => {
        const { expr, diagnostics } = parse('starrt + 1d');
        expect(expr).toBeNull();
        expect(diagnostics.some(d => d.code === 'expr.unknown-ident')).toBe(true);
    });

    it('reports missing closing paren on calls', () => {
        const { expr, diagnostics } = parse('format(start, "x"');
        expect(expr).toBeNull();
        expect(diagnostics.some(d => d.code === 'expr.expected-rparen-call')).toBe(true);
    });

    it('reports missing closing paren on groups', () => {
        const { expr, diagnostics } = parse('(start + 1d');
        expect(expr).toBeNull();
        expect(diagnostics.some(d => d.code === 'expr.expected-rparen')).toBe(true);
    });

    it('reports incomplete ternary', () => {
        const { expr, diagnostics } = parse('true ? 1');
        expect(expr).toBeNull();
        expect(diagnostics.some(d => d.code === 'expr.expected-colon')).toBe(true);
    });
});
