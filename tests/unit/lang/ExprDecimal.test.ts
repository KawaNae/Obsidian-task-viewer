import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../../src/services/lang/Diagnostic';
import { EvalError, type EvalContext, evalExpr } from '../../../src/services/lang/ExprEvaluator';
import { parseExpr } from '../../../src/services/lang/ExprParser';
import { printExpr } from '../../../src/services/lang/ExprPrinter';
import type { EvalHost } from '../../../src/services/lang/functions';
import { tokenize } from '../../../src/services/lang/Lexer';
import { TokenCursor } from '../../../src/services/lang/Token';
import { MAX_EXACT_FRACTION, type Value, valueToLiteral } from '../../../src/services/lang/Value';

const stubHost: EvalHost = {
    formatDate: (value, tokens) => `[${tokens}:${value.type === 'date' ? value.value : '?'}]`,
};

function parse(src: string, profile?: Parameters<typeof parseExpr>[2]) {
    const { tokens, diagnostics } = tokenize(src);
    const expr = parseExpr(new TokenCursor(tokens), diagnostics, profile);
    return { expr, diagnostics };
}

function evaluate(src: string, profile?: Parameters<typeof parseExpr>[2]): Value {
    const { expr, diagnostics } = parse(src, profile);
    if (!expr) throw new Error(`parse failed: ${diagnostics.map(d => d.message).join('; ')}`);
    return evalExpr(expr, {
        props: {},
        today: '2026-08-16',
        now: { date: '2026-08-16', time: '10:00' },
        weekStartDay: 1,
        host: stubHost,
    } as EvalContext);
}

const num = (src: string) => (evaluate(src) as Value & { type: 'number' }).value;
const codes = (ds: Diagnostic[]) => ds.map(d => d.code);

/**
 * Numbers are decimal here. The double underneath is only the carrier: every
 * operation lands back on a grid of ten decimal places, which is what makes a
 * cell's value survive being printed and read back each generation.
 */
describe('decimal numbers', () => {
    it('adds and multiplies the way the decimals read', () => {
        // JS: 0.30000000000000004
        expect(num('0.1 + 0.2')).toBe(0.3);
        expect(num('0.1 * 3')).toBe(0.3);
        expect(num('0.1 + 0.7')).toBe(0.8);
        expect(num('1.1 - 1')).toBe(0.1);
        // 比較も同じ答えになる（『驚きが減る方向のずれ』の実体）
        expect(evaluate('0.1 + 0.2 == 0.3')).toEqual({ type: 'bool', value: true });
    });

    it('rounds division to the same grid', () => {
        expect(num('1 / 3')).toBe(0.3333333333);
        expect(num('7 / 2')).toBe(3.5);
        expect(() => evaluate('1 / 0')).toThrow(EvalError);
    });

    it('takes the remainder from the quotient, not from the carrier', () => {
        // 素の % は 0.3 % 0.1 を 0.0999… にする。量子化しても 0.1 に落ちて
        // 10 進の答え（0）にならないので、格子に載せた商から導く。
        expect(num('0.3 % 0.1')).toBe(0);
        expect(num('0.7 % 0.1')).toBe(0);
        expect(num('1.5 % 0.4')).toBe(0.3);
        // 整数の剰余と符号は JS のまま
        expect(num('7 % 3')).toBe(1);
        expect(num('0 - 7 % 3')).toBe(-1);
    });

    it('refuses a number it could not hold exactly', () => {
        // 端 = 2^19。その上の binade では ulp が格子間隔 1e-10 を超え、
        // 隣接する格子点が同じ double に潰れる。黙って精度を落とさず、
        // 評価失敗で教える
        expect(() => evaluate(`${MAX_EXACT_FRACTION} + 0.5`)).toThrow(EvalError);
        expect(num('500000 + 0.5')).toBe(500000.5);
    });

    it('refuses a literal past the exact range at the lexer', () => {
        // quantize は演算結果しか守らない。リテラルは格子へのもう 1 つの
        // 入口なので、書かれた場所で大きさを見る（レビュー実測: この値は
        // 受理すると印字で 600000.0000000003 に化ける）
        expect(codes(parse('600000.0000000004').diagnostics)).toContain('lex.decimal-too-large');
        expect(parse('500000.0000000004').diagnostics).toEqual([]);
        // 小数点以下が全部ゼロなら値は整数で、2^53 まで正確 — 拒否しない
        expect(parse('600000.0').diagnostics).toEqual([]);
    });

    it('reads a decimal literal, and refuses one finer than the grid', () => {
        expect(parse('0.5').diagnostics).toEqual([]);
        expect(num('0.0000000001')).toBe(0.0000000001);
        expect(codes(parse('0.00000000001').diagnostics)).toContain('lex.decimal-too-precise');
    });

    it('refuses a duration written with a fraction', () => {
        // duration は整数 + 単位。0.5d は書き戻せないので、字句の段階で言う
        expect(codes(parse('0.5d').diagnostics)).toContain('lex.decimal-duration');
        expect(codes(parse('1d / 2').diagnostics)).toEqual([]);
        expect(() => evaluate('1d / 2')).toThrow(EvalError);
        expect(evaluate('24h / 2')).toEqual({ type: 'duration', amount: 12, unit: 'h' });
    });

    it('requires a whole number where JS would quietly truncate one', () => {
        // JS は slice(1.5) を黙って slice(1) にする。境界が小数を拾った日に
        // 意味が静かに変わるので、数えの位置は整数を要求する
        expect(() => evaluate('"abcde".slice(1.5)')).toThrow(EvalError);
        expect(() => evaluate('"5".padStart(2.5)')).toThrow(EvalError);
        expect(() => evaluate('(1 / 3).toFixed(2.5)')).toThrow(EvalError);
        expect(() => evaluate('[1, 2, 3].slice(0.5)', 'block')).toThrow(EvalError);
        // 添字は JS と同じく「見つからない = none」
        expect(evaluate('[1, 2, 3][1.5]', 'block')).toEqual({ type: 'none' });
    });

    it('writes a number so the lexer can read it again', () => {
        // String(1e-7) は '1e-7' を返し、字句が読めない。往復が壊れるのは
        // まさに格子が支えるべき小さい値なので、固定小数点で書く。
        expect(valueToLiteral({ type: 'number', value: 0.0000001 })).toBe('0.0000001');
        expect(valueToLiteral({ type: 'number', value: 0.3 })).toBe('0.3');
        // 正確な範囲の中では、格子点は印字と読み戻しでちょうど 1 往復する
        expect(valueToLiteral({ type: 'number', value: 500000.0000000004 })).toBe('500000.0000000004');
        expect(valueToLiteral({ type: 'number', value: 3 })).toBe('3');
        const { expr } = parse('0.0000001');
        expect(printExpr(expr!)).toBe('0.0000001');
    });
});
