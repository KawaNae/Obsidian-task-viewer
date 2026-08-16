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
    const ctx: EvalContext = {
        props,
        today: '2026-07-02',
        now: { date: '2026-07-02', time: '10:00' },
        weekStartDay: 1,
        host: stubHost,
    };
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

    it('truncates datetimes with date()', () => {
        expect(evaluate('date(2026-07-14T11:00)')).toEqual({ type: 'date', value: '2026-07-14' });
        expect(evaluate('date(2026-07-14)')).toEqual({ type: 'date', value: '2026-07-14' });
        expect(evaluate('date(start + 3d)', { start: { type: 'datetime', date: '2026-07-14', time: '11:00' } }))
            .toEqual({ type: 'date', value: '2026-07-17' });
    });

    it('attaches a time with date + time', () => {
        expect(evaluate('2026-07-17 + 13:00')).toEqual({ type: 'datetime', date: '2026-07-17', time: '13:00' });
        // The full absolute-time idiom: keep the date, replace the time
        expect(evaluate('date(start) + 13:00', { start: { type: 'datetime', date: '2026-07-17', time: '11:00' } }))
            .toEqual({ type: 'datetime', date: '2026-07-17', time: '13:00' });
    });

    it('rejects datetime + time as ambiguous', () => {
        expect(() => evaluate('2026-07-17T11:00 + 13:00')).toThrow(EvalError);
    });

    it('computes next weekday strictly after the base', () => {
        // 2026-07-02 is a Thursday
        expect(evaluate('next("thu")')).toEqual({ type: 'date', value: '2026-07-09' });
        expect(evaluate('next("fri")')).toEqual({ type: 'date', value: '2026-07-03' });
        expect(evaluate('next("mon", 2026-07-02)')).toEqual({ type: 'date', value: '2026-07-06' });
    });

    it('computes grid occurrences (the engine behind every <interval>)', () => {
        // today = 2026-07-02; anchor 6/24, 3d grid: 6/27, 6/30, 7/3 → 7/3
        expect(evaluate('nextCycle(2026-06-24, 3d)')).toEqual({ type: 'date', value: '2026-07-03' });
        // month grid clamps like every Nmo (anchor day 31 = month-end behavior)
        expect(evaluate('nextCycle(2026-01-31, 1mo)')).toEqual({ type: 'date', value: '2026-07-31' });
        // minute/hour grids are datetime-valued
        expect(evaluate('nextCycle(2026-07-02T01:00, 4h)')).toEqual({ type: 'datetime', date: '2026-07-02', time: '13:00' });
        // future anchor (early completion): first point after the anchor itself
        expect(evaluate('nextCycle(2026-07-07, 3d)')).toEqual({ type: 'date', value: '2026-07-10' });
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

    it('evaluates none literal', () => {
        expect(evaluate('none')).toEqual({ type: 'none' });
    });

    it('evaluates time() on datetime', () => {
        expect(evaluate('time(2026-07-15T14:30)')).toEqual({ type: 'time', value: '14:30' });
    });

    it('evaluates time() on date as none', () => {
        expect(evaluate('time(2026-07-15)')).toEqual({ type: 'none' });
    });

    it('evaluates time() on a property', () => {
        expect(evaluate('time(start)', { start: { type: 'datetime', date: '2026-07-15', time: '09:00' } }))
            .toEqual({ type: 'time', value: '09:00' });
        expect(evaluate('time(start)', { start: { type: 'date', value: '2026-07-15' } }))
            .toEqual({ type: 'none' });
    });

    it('evaluates time() on arithmetic result', () => {
        expect(evaluate('time(2026-07-15 + 2h)')).toEqual({ type: 'time', value: '02:00' });
    });

    describe('multiplicative', () => {
        it('multiplies and takes the remainder of numbers', () => {
            expect(evaluate('3 * 4')).toEqual({ type: 'number', value: 12 });
            expect(evaluate('7 % 3')).toEqual({ type: 'number', value: 1 });
        });

        it('scales a duration, keeping its unit', () => {
            // 間隔反復（gap を倍にする）で使う形。
            expect(evaluate('1d * 2')).toEqual({ type: 'duration', amount: 2, unit: 'd' });
            expect(evaluate('2 * 3h')).toEqual({ type: 'duration', amount: 6, unit: 'h' });
            expect(evaluate('4w / 2')).toEqual({ type: 'duration', amount: 2, unit: 'w' });
        });

        it('refuses a fractional duration instead of writing one that cannot be read back', () => {
            // duration リテラルは整数 + 単位なので、2.5d は書けても読み戻せない。
            // 印字できない値を作らせないことで round-trip を守る。
            expect(() => evaluate('1d / 2')).toThrow(EvalError);
            expect(() => evaluate('3d / 2')).toThrow(EvalError);
            // 小さい単位で言えば通る。
            expect(evaluate('24h / 2')).toEqual({ type: 'duration', amount: 12, unit: 'h' });
        });

        it('rounds division to a fixed number of places', () => {
            // 1 / 3 は終わらないので、桁数を規則で決める。
            expect(evaluate('1 / 3')).toEqual({ type: 'number', value: 0.3333333333 });
            expect(evaluate('10 / 4')).toEqual({ type: 'number', value: 2.5 });
        });

        it('fails on division by zero instead of producing infinity', () => {
            // 評価が失敗すればコマンドは消費されない。無限大の値表現は持たない。
            expect(() => evaluate('1 / 0')).toThrow(EvalError);
            expect(() => evaluate('1d / 0')).toThrow(EvalError);
        });

        it('binds tighter than addition', () => {
            expect(evaluate('1 + 2 * 3')).toEqual({ type: 'number', value: 7 });
            expect(evaluate('(1 + 2) * 3')).toEqual({ type: 'number', value: 9 });
        });
    });

    describe('members and methods', () => {
        it('formats a date through the method form', () => {
            expect(evaluate('start.format("YYYY-MM-DD")', { start: { type: 'date', value: '2026-08-17' } }))
                .toEqual({ type: 'string', value: '[YYYY-MM-DD:2026-08-17]' });
        });

        it('names the weekday as a string', () => {
            // 曜日は文字列で返す。引用符付きの比較が静かに false にならないため。
            expect(evaluate('start.weekday()', { start: { type: 'date', value: '2026-08-18' } }))
                .toEqual({ type: 'string', value: 'tue' });
            expect(evaluate('start.weekday() === "tue"', { start: { type: 'date', value: '2026-08-18' } }))
                .toEqual({ type: 'bool', value: true });
        });

        it('reads string members and methods', () => {
            expect(evaluate('"週報".length')).toEqual({ type: 'number', value: 2 });
            expect(evaluate('"abc".toUpperCase()')).toEqual({ type: 'string', value: 'ABC' });
            expect(evaluate('"a-b".replace("-", "+")')).toEqual({ type: 'string', value: 'a+b' });
            expect(evaluate('"abc".includes("b")')).toEqual({ type: 'bool', value: true });
        });

        it('short-circuits optional chaining on a missing value', () => {
            expect(evaluate('end?.format("MM")', { end: { type: 'none' } })).toEqual({ type: 'none' });
            expect(() => evaluate('end.format("MM")', { end: { type: 'none' } })).toThrow(EvalError);
        });

        it('resolves the tv namespace to the bare built-ins', () => {
            expect(evaluate('tv.date.format(start, "MM/DD")', { start: { type: 'date', value: '2026-08-17' } }))
                .toEqual({ type: 'string', value: '[MM/DD:2026-08-17]' });
        });
    });
    it('falls back with ?? only when the left side is none', () => {
        expect(evaluate('time(2026-07-15) ?? 09:00')).toEqual({ type: 'time', value: '09:00' });
        expect(evaluate('time(2026-07-15T14:30) ?? 09:00')).toEqual({ type: 'time', value: '14:30' });
    });

    it('names the weekday in the same seven identifiers everywhere', () => {
        const props = { start: { type: 'date', value: '2026-07-02' } } as EvalContext['props'];
        expect(evaluate('start.weekday()', props)).toEqual({ type: 'string', value: 'thu' });
        expect(evaluate('start.weekday() == "thu"', props)).toEqual({ type: 'bool', value: true });
    });

    it('replaces the first occurrence, replaceAll every one', () => {
        const props = { content: { type: 'string', value: 'a-a-a' } } as EvalContext['props'];
        expect(evaluate('content.replace("a", "b")', props)).toEqual({ type: 'string', value: 'b-a-a' });
        expect(evaluate('content.replaceAll("a", "b")', props)).toEqual({ type: 'string', value: 'b-b-b' });
    });

    it('counts length in the same units indexOf and slice use', () => {
        const props = { content: { type: 'string', value: '\u{1F389}ab' } } as EvalContext['props'];
        expect(evaluate('content.length', props)).toEqual({ type: 'number', value: 4 });
        expect(evaluate('content.indexOf("a")', props)).toEqual({ type: 'number', value: 2 });
    });
});
