import { describe, it, expect } from 'vitest';
import { Diagnostic } from '../../../src/services/lang/Diagnostic';
import { FLOW_TYPE_ENV, checkExpr } from '../../../src/services/lang/ExprChecker';
import { parseExpr } from '../../../src/services/lang/ExprParser';
import { StaticType } from '../../../src/services/lang/functions';
import { tokenize } from '../../../src/services/lang/Lexer';
import { TokenCursor } from '../../../src/services/lang/Token';

function check(src: string): { type: StaticType; diagnostics: Diagnostic[] } {
    const { tokens, diagnostics } = tokenize(src);
    const expr = parseExpr(new TokenCursor(tokens), diagnostics);
    if (!expr) return { type: 'error', diagnostics };
    const type = checkExpr(expr, FLOW_TYPE_ENV, diagnostics);
    return { type, diagnostics };
}

describe('ExprChecker', () => {
    it('types date arithmetic as datish', () => {
        expect(check('start + 3d')).toMatchObject({ type: 'datish', diagnostics: [] });
        expect(check('2026-07-15 + 1mo')).toMatchObject({ type: 'date', diagnostics: [] });
        expect(check('done - 2h')).toMatchObject({ type: 'datetime', diagnostics: [] });
    });

    it('types string concatenation', () => {
        expect(check('"a" + content')).toMatchObject({ type: 'string', diagnostics: [] });
    });

    it('types comparisons across the datish family', () => {
        expect(check('start < due')).toMatchObject({ type: 'bool', diagnostics: [] });
        expect(check('done > 2026-07-15')).toMatchObject({ type: 'bool', diagnostics: [] });
    });

    it('types function results', () => {
        expect(check('format(start, "MM/DD")')).toMatchObject({ type: 'string', diagnostics: [] });
        expect(check('next(tue)')).toMatchObject({ type: 'date', diagnostics: [] });
        expect(check('endOf(month, start)')).toMatchObject({ type: 'date', diagnostics: [] });
        expect(check('date(start)')).toMatchObject({ type: 'date', diagnostics: [] });
    });

    it('types date + time as datetime, rejects datish + time', () => {
        expect(check('date(start) + 13:00')).toMatchObject({ type: 'datetime', diagnostics: [] });
        const { type, diagnostics } = check('start + 13:00');
        expect(type).toBe('error');
        expect(diagnostics.some(d => d.code === 'type.datetime-plus-time')).toBe(true);
    });

    it('types conditionals', () => {
        expect(check('start < due ? start : due')).toMatchObject({ type: 'datish', diagnostics: [] });
        expect(check('true ? 1 : 2')).toMatchObject({ type: 'number', diagnostics: [] });
    });

    it('rejects date + date', () => {
        const { type, diagnostics } = check('start + due');
        expect(type).toBe('error');
        expect(diagnostics.some(d => d.code === 'type.cannot-combine')).toBe(true);
        expect(diagnostics[0].params).toMatchObject({ op: '+', left: 'datish', right: 'datish' });
    });

    it('rejects string vs number comparison', () => {
        expect(check('content < 3').type).toBe('error');
    });

    it('rejects wrong argument types', () => {
        const { diagnostics } = check('format(3, "MM/DD")');
        expect(diagnostics.some(d => d.code === 'type.arg-mismatch')).toBe(true);
    });

    it('rejects wrong argument counts', () => {
        const { diagnostics } = check('format(start)');
        expect(diagnostics.some(d => d.code === 'type.arg-count')).toBe(true);
    });

    it('rejects invalid unit keywords in startOf', () => {
        const { diagnostics } = check('startOf("day")');
        expect(diagnostics.some(d => d.code === 'type.bad-unit-keyword')).toBe(true);
    });

    it('rejects non-bool condition', () => {
        const { diagnostics } = check('3 ? 1 : 2');
        expect(diagnostics.some(d => d.code === 'type.cond-not-bool')).toBe(true);
    });

    it('poisons upward without duplicate diagnostics', () => {
        const { diagnostics } = check('(start + due) + 1d');
        expect(diagnostics.filter(d => d.severity === 'error')).toHaveLength(1);
    });

    it('types none literal as none', () => {
        expect(check('none')).toMatchObject({ type: 'none', diagnostics: [] });
    });

    it('types time() as time', () => {
        expect(check('time(start)')).toMatchObject({ type: 'time', diagnostics: [] });
    });

    it('rejects time + duration with specific diagnostic', () => {
        expect(check('14:00 + 2h').diagnostics.some(d => d.code === 'type.time-arithmetic')).toBe(true);
        expect(check('2h + 14:00').diagnostics.some(d => d.code === 'type.time-arithmetic')).toBe(true);
    });

    it('absorbs none in conditional branches', () => {
        expect(check('start < due ? none : start + 1d')).toMatchObject({ type: 'datish', diagnostics: [] });
        expect(check('start < due ? start : none')).toMatchObject({ type: 'datish', diagnostics: [] });
        expect(check('start < due ? none : 14:00')).toMatchObject({ type: 'time', diagnostics: [] });
        expect(check('start < due ? none : none')).toMatchObject({ type: 'none', diagnostics: [] });
    });
});
