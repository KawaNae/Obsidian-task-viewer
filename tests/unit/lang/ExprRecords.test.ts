import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../../src/services/lang/Diagnostic';
import { FLOW_TYPE_ENV, checkExpr } from '../../../src/services/lang/ExprChecker';
import { type EvalContext, evalExpr } from '../../../src/services/lang/ExprEvaluator';
import { parseExpr } from '../../../src/services/lang/ExprParser';
import { printExpr } from '../../../src/services/lang/ExprPrinter';
import type { EvalHost, StaticType } from '../../../src/services/lang/functions';
import { tokenize } from '../../../src/services/lang/Lexer';
import { TokenCursor } from '../../../src/services/lang/Token';
import type { Value } from '../../../src/services/lang/Value';

/**
 * Records and spreads. Both belong to the generation block, for the same
 * reason lists do: a flow command has to print back to canonical source, and
 * the way to keep that contract small is to keep these off that surface.
 */
function parseIn(src: string, profile: 'flow' | 'block' = 'block') {
    const { tokens, diagnostics } = tokenize(src);
    const expr = parseExpr(new TokenCursor(tokens), diagnostics, profile);
    return { expr, diagnostics };
}

function check(src: string): { type: StaticType; diagnostics: Diagnostic[] } {
    const { expr, diagnostics } = parseIn(src);
    if (!expr) return { type: 'error', diagnostics };
    return { type: checkExpr(expr, FLOW_TYPE_ENV, diagnostics), diagnostics };
}

const stubHost: EvalHost = {
    formatDate: (value, tokens) => `[${tokens}:${value.type === 'date' ? value.value : '?'}]`,
};

function evaluate(src: string, props: EvalContext['props'] = {}): Value {
    const { expr, diagnostics } = parseIn(src);
    if (!expr) throw new Error(`parse failed: ${diagnostics.map(d => d.message).join('; ')}`);
    return evalExpr(expr, {
        props,
        today: '2026-08-16',
        now: { date: '2026-08-16', time: '10:00' },
        weekStartDay: 1,
        host: stubHost,
    });
}

const codes = (ds: Diagnostic[]) => ds.map(d => d.code);

describe('records', () => {
    it('is refused in a flow command, like a list', () => {
        expect(codes(parseIn('{a: 1}', 'flow').diagnostics)).toContain('expr.record-not-here');
    });

    it('types each field by what was written', () => {
        expect(check('{a: 1, b: "x"}').type).toEqual({ fields: { a: 'number', b: 'string' } });
        expect(check('{}').type).toEqual({ fields: {} });
        // 文字列のキーも書ける（名前にできない語のため）
        expect(check('{"a b": 1}').type).toEqual({ fields: { 'a b': 'number' } });
    });

    it('reads a field by name, and refuses one it does not have', () => {
        expect(check('{a: 1}.a').type).toBe('number');
        expect(codes(check('{a: 1}.b').diagnostics)).toContain('type.unknown-field');
        expect(codes(check('{a: 1}.map(x => x)').diagnostics)).toContain('type.unknown-member');
    });

    it('reads a field by a constant key the same way', () => {
        expect(check('{a: 1}["a"]').type).toBe('number');
        expect(codes(check('{a: 1}["b"]').diagnostics)).toContain('type.unknown-field');
        expect(codes(check('{a: 1}[0]').diagnostics)).toContain('type.index-not-string');
    });

    it('answers a computed key with the type the fields share', () => {
        // 曜日で引く表。どのキーが来ても string なので string
        expect(check('{mon: "燃えるゴミ", tue: "資源"}[content]').type).toBe('string');
        // 型が揃っていなければ、どれか 1 つを答えるのではなく言う
        expect(codes(check('{a: 1, b: "x"}[content]').diagnostics)).toContain('type.record-fields-differ');
    });

    it('evaluates a lookup table, and reads a missing field as none', () => {
        const props = { content: { type: 'string', value: 'tue' } } as EvalContext['props'];
        expect(evaluate('{mon: "燃えるゴミ", tue: "資源"}[content]', props))
            .toEqual({ type: 'string', value: '資源' });
        expect(evaluate('{mon: "a"}[content] ?? "その他"', props))
            .toEqual({ type: 'string', value: 'その他' });
        expect(evaluate('{a: 1}.a')).toEqual({ type: 'number', value: 1 });
    });

    it('keeps the order it was written in', () => {
        // 印字して読み直しても並びが変わらない（順序が変わると別の式になる）
        const src = '{b: 1, a: 2}';
        const { expr, diagnostics } = parseIn(src);
        expect(diagnostics).toEqual([]);
        expect(printExpr(expr!)).toBe(src);
    });

    it('has only the fields that were written', () => {
        // 素のオブジェクトで持つと、書いていない toString や constructor が
        // 「在る」と判定され、型検査が junk 型を下流へ流す。フィールド名は
        // 文書から来るので、JS がただで付ける名前は 1 つも継がない。
        expect(codes(check('{a: 1}.toString').diagnostics)).toContain('type.unknown-field');
        expect(codes(check('{a: 1}["toString"]').diagnostics)).toContain('type.unknown-field');
        expect(codes(check('{a: 1}.constructor').diagnostics)).toContain('type.unknown-field');
        // __proto__ はフィールド名であって、継承先を差し替える手段ではない。
        // 期待値の側も同じ罠を踏むので、キーを直接見る（オブジェクトリテラル
        // に書くと、こちらの __proto__ がプロトタイプ指定として消える）
        const protoField = check('{"__proto__": 1}').type as { fields: Record<string, unknown> };
        expect(Object.keys(protoField.fields)).toEqual(['__proto__']);
        expect(check('{"__proto__": 1}["__proto__"]').type).toBe('number');
        // 評価側も同じ答えを返す（検査と評価が食い違わない）
        expect(evaluate('{"__proto__": 1}["__proto__"]')).toEqual({ type: 'number', value: 1 });
        expect(evaluate('{a: 1}["toString"] ?? "無い"')).toEqual({ type: 'string', value: '無い' });
    });

    it('says where a field name is missing', () => {
        expect(codes(parseIn('{1: "a"}').diagnostics)).toContain('expr.expected-field-name');
        expect(codes(parseIn('{a 1}').diagnostics)).toContain('expr.expected-field-value');
        expect(codes(parseIn('{a: 1').diagnostics)).toContain('expr.expected-rbrace');
    });
});

describe('spread', () => {
    it('is refused in a flow command', () => {
        expect(codes(parseIn('[...content]', 'flow').diagnostics)).toContain('expr.list-not-here');
    });

    it('adds the elements of the list it holds', () => {
        expect(check('[...["a"], "b"]').type).toEqual({ array: 'string' });
        expect(evaluate('[...["a", "b"], "c"].join(",")')).toEqual({ type: 'string', value: 'a,b,c' });
        expect(evaluate('[...[], "c"].length')).toEqual({ type: 'number', value: 1 });
    });

    it('needs a list to spread', () => {
        expect(codes(check('[...content]').diagnostics)).toContain('type.spread-not-a-list');
    });

    it('only means something inside a list', () => {
        expect(codes(parseIn('...["a"]').diagnostics)).toContain('expr.spread-not-here');
    });

    it('is what the immutable-list diagnostic now offers', () => {
        // 案内した書き方がその時点で動くこと。スプレッドが入ったので両方名指しできる
        const { diagnostics } = check('["a"].push("b")');
        expect(codes(diagnostics)).toContain('type.list-immutable');
        expect(diagnostics[0].message).toContain('concat');
        expect(diagnostics[0].message).toContain('spread');
        expect(check('[...["a"], "b"]').diagnostics).toEqual([]);
    });
});
