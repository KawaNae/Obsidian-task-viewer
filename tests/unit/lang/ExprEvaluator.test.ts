import { describe, it, expect } from 'vitest';
import { EvalContext, EvalError, evalExpr } from '../../../src/services/lang/ExprEvaluator';
import { parseExpr } from '../../../src/services/lang/ExprParser';
import { EvalHost } from '../../../src/services/lang/functions';
import { tokenize } from '../../../src/services/lang/Lexer';
import { TokenCursor } from '../../../src/services/lang/Token';
import { Value } from '../../../src/services/lang/Value';

const stubHost: EvalHost = {
    formatDate: (value, tokens) => `[${tokens}:${value.type === 'date' ? value.value : value.type === 'datetime' ? value.date : '?'}]`,
};

function evaluate(src: string, props: EvalContext['props'] = {}): Value {
    const { tokens, diagnostics } = tokenize(src);
    const expr = parseExpr(new TokenCursor(tokens), diagnostics);
    if (!expr) throw new Error(`parse failed: ${diagnostics.map(d => d.message).join('; ')}`);
    const ctx: EvalContext = { props, today: '2026-07-02', weekStartDay: 1, host: stubHost };
    return evalExpr(expr, ctx);
}

describe('ExprEvaluator', () => {
    it('adds durations to dates', () => {
        expect(evaluate('2026-07-15 + 3d')).toEqual({ type: 'date', value: '2026-07-18' });
        expect(evaluate('2026-07-15 - 1w')).toEqual({ type: 'date', value: '2026-07-08' });
    });

    it('clamps month-end when adding months', () => {
        expect(evaluate('2026-01-31 + 1mo')).toEqual({ type: 'date', value: '2026-02-28' });
    });

    it('promotes date to datetime for minute/hour arithmetic', () => {
        expect(evaluate('2026-07-15 + 2h')).toEqual({ type: 'datetime', date: '2026-07-15', time: '02:00' });
    });

    it('keeps time when shifting datetimes by days', () => {
        expect(evaluate('2026-07-15T14:30 + 2d')).toEqual({ type: 'datetime', date: '2026-07-17', time: '14:30' });
    });

    it('rolls datetime across midnight', () => {
        expect(evaluate('2026-07-15T23:30 + 1h')).toEqual({ type: 'datetime', date: '2026-07-16', time: '00:30' });
    });

    it('evaluates property references', () => {
        expect(evaluate('start + 1d', { start: { type: 'date', value: '2026-07-01' } }))
            .toEqual({ type: 'date', value: '2026-07-02' });
    });

    it('throws EvalError for unset properties', () => {
        expect(() => evaluate('due + 1d')).toThrow(EvalError);
    });

    it('concatenates strings', () => {
        expect(evaluate('"週報 " + content', { content: { type: 'string', value: 'A' } }))
            .toEqual({ type: 'string', value: '週報 A' });
    });

    it('compares dates and datetimes together', () => {
        expect(evaluate('2026-07-15 < 2026-07-15T00:01')).toEqual({ type: 'bool', value: true });
        expect(evaluate('2026-07-15 == 2026-07-15T00:00')).toEqual({ type: 'bool', value: true });
    });

    it('short-circuits logicals', () => {
        // 'due' is unset; || must not evaluate the right side
        expect(evaluate('true || due < 2026-01-01')).toEqual({ type: 'bool', value: true });
    });

    it('evaluates ternary', () => {
        expect(evaluate('2 > 1 ? "a" : "b"')).toEqual({ type: 'string', value: 'a' });
    });

    it('calls format via the injected host', () => {
        expect(evaluate('format(2026-07-15, "MM/DD")')).toEqual({ type: 'string', value: '[MM/DD:2026-07-15]' });
    });

    it('computes next weekday strictly after the base', () => {
        // 2026-07-02 is a Thursday
        expect(evaluate('next(thu)')).toEqual({ type: 'date', value: '2026-07-09' });
        expect(evaluate('next(fri)')).toEqual({ type: 'date', value: '2026-07-03' });
        expect(evaluate('next(mon, 2026-07-02)')).toEqual({ type: 'date', value: '2026-07-06' });
    });

    it('computes startOf/endOf with weekStartDay', () => {
        // weekStartDay=1 (Monday); 2026-07-02 is Thursday
        expect(evaluate('startOf(week)')).toEqual({ type: 'date', value: '2026-06-29' });
        expect(evaluate('endOf(week)')).toEqual({ type: 'date', value: '2026-07-05' });
        expect(evaluate('startOf(month, 2026-07-15)')).toEqual({ type: 'date', value: '2026-07-01' });
        expect(evaluate('endOf(month, 2026-02-10)')).toEqual({ type: 'date', value: '2026-02-28' });
        expect(evaluate('endOf(year)')).toEqual({ type: 'date', value: '2026-12-31' });
    });

    it('supports composed date pipelines', () => {
        // startOf(next month) + 4d
        expect(evaluate('startOf(month, 2026-07-15 + 1mo) + 4d')).toEqual({ type: 'date', value: '2026-08-05' });
    });

    it('mixes convertible duration units', () => {
        expect(evaluate('1h + 30min')).toEqual({ type: 'duration', amount: 90, unit: 'min' });
    });

    it('rejects mixing calendar units in duration arithmetic', () => {
        expect(() => evaluate('1mo + 30min')).toThrow(EvalError);
    });
});
