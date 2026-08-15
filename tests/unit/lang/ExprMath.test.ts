import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../../src/services/lang/Diagnostic';
import { FLOW_TYPE_ENV, checkExpr } from '../../../src/services/lang/ExprChecker';
import { type EvalContext, evalExpr } from '../../../src/services/lang/ExprEvaluator';
import { parseExpr } from '../../../src/services/lang/ExprParser';
import { printExpr } from '../../../src/services/lang/ExprPrinter';
import type { EvalHost } from '../../../src/services/lang/functions';
import { tokenize } from '../../../src/services/lang/Lexer';
import { TokenCursor } from '../../../src/services/lang/Token';
import type { Value } from '../../../src/services/lang/Value';

function parse(src: string) {
    const { tokens, diagnostics } = tokenize(src);
    const expr = parseExpr(new TokenCursor(tokens), diagnostics);
    return { expr, diagnostics };
}

function check(src: string) {
    const { expr, diagnostics } = parse(src);
    if (!expr) return { type: 'error' as const, diagnostics };
    return { type: checkExpr(expr, FLOW_TYPE_ENV, diagnostics), diagnostics };
}

const stubHost: EvalHost = {
    formatDate: (value, tokens) => `[${tokens}:${value.type === 'date' ? value.value : '?'}]`,
};

function evaluate(src: string): Value {
    const { expr, diagnostics } = parse(src);
    if (!expr) throw new Error(`parse failed: ${diagnostics.map(d => d.message).join('; ')}`);
    return evalExpr(expr, {
        props: {},
        today: '2026-08-16',
        now: { date: '2026-08-16', time: '10:00' },
        weekStartDay: 1,
        host: stubHost,
    });
}

const codes = (ds: Diagnostic[]) => ds.map(d => d.code);

describe('Math', () => {
    it('is written and printed with its namespace', () => {
        // ドットは識別子に現れないので、裸の floor という綴りは存在しない。
        // 予約する名前を 6 つ増やさずに済み、印字したものがそのまま読める。
        const { expr, diagnostics } = parse('Math.floor(7 / 2)');
        expect(diagnostics).toEqual([]);
        expect(printExpr(expr!)).toBe('Math.floor(7 / 2)');
        expect(codes(parse('floor(1)').diagnostics)).toContain('expr.unknown-ident');
    });

    it('rounds the quotient division leaves behind', () => {
        // 10 桁まで運ばれる商を、タスクに書ける整数へ戻すのが主な用途
        expect(evaluate('Math.round(7 / 2)')).toEqual({ type: 'number', value: 4 });
        expect(evaluate('Math.floor(7 / 2)')).toEqual({ type: 'number', value: 3 });
        expect(evaluate('Math.ceil(7 / 2)')).toEqual({ type: 'number', value: 4 });
        expect(evaluate('Math.abs(0 - 3)')).toEqual({ type: 'number', value: 3 });
    });

    it('takes as many arguments as min and max are given', () => {
        expect(evaluate('Math.min(3, 1, 2)')).toEqual({ type: 'number', value: 1 });
        expect(evaluate('Math.max(3, 1, 2)')).toEqual({ type: 'number', value: 3 });
        expect(check('Math.min(1, 2, 3, 4)').diagnostics).toEqual([]);
        // 可変長でも型は見る
        expect(codes(check('Math.max(1, "x")').diagnostics)).toContain('type.arg-mismatch');
        expect(codes(check('Math.floor(1, 2)').diagnostics)).toContain('type.arg-count');
    });

    it('reports an unknown member and a function left uncalled', () => {
        expect(codes(parse('Math.sqrt(4)').diagnostics)).toContain('expr.unknown-property');
        expect(codes(parse('Math.floor').diagnostics)).toContain('expr.expected-call');
        expect(codes(parse('Math').diagnostics)).toContain('expr.namespace-needs-member');
    });

    it('shares its resolution with the tv namespace', () => {
        // 判定が 2 実装に割れていないこと: 同じ診断コードが両方から出る
        expect(codes(parse('tv').diagnostics)).toContain('expr.namespace-needs-member');
        expect(codes(parse('tv.nope.x').diagnostics)).toContain('expr.unknown-property');
        expect(parse('tv.date.startOf("month", start)').diagnostics).toEqual([]);
    });

    it('is available in a flow command, unlike a list', () => {
        // 値は number のままなので印字の語彙は増えない
        expect(check('Math.max(1, 2)').type).toBe('number');
        expect(check('Math.max(1, 2)').diagnostics).toEqual([]);
    });
});
