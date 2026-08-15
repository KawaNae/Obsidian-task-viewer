import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../../src/services/lang/Diagnostic';
import { FLOW_TYPE_ENV, SCALAR_MEMBER_SIGS, checkExpr } from '../../../src/services/lang/ExprChecker';
import { type EvalContext, evalExpr } from '../../../src/services/lang/ExprEvaluator';
import { parseExpr } from '../../../src/services/lang/ExprParser';
import { type EvalHost, FN_SIGS, type StaticType, isArrayType } from '../../../src/services/lang/functions';
import { tokenize } from '../../../src/services/lang/Lexer';
import { TokenCursor } from '../../../src/services/lang/Token';
import type { Value } from '../../../src/services/lang/Value';

/**
 * Lists, indexing and the functions written for them. All of it belongs to the
 * generation block: a flow command has no way to reach a list, which is what
 * keeps the canonical printer's vocabulary closed.
 */
function parseBlock(src: string): { expr: ReturnType<typeof parseExpr>; diagnostics: Diagnostic[] } {
    const { tokens, diagnostics } = tokenize(src);
    const expr = parseExpr(new TokenCursor(tokens), diagnostics, 'block');
    return { expr, diagnostics };
}

function parseFlowExpr(src: string): { expr: ReturnType<typeof parseExpr>; diagnostics: Diagnostic[] } {
    const { tokens, diagnostics } = tokenize(src);
    const expr = parseExpr(new TokenCursor(tokens), diagnostics, 'flow');
    return { expr, diagnostics };
}

function check(src: string): { type: StaticType; diagnostics: Diagnostic[] } {
    const { expr, diagnostics } = parseBlock(src);
    if (!expr) return { type: 'error', diagnostics };
    return { type: checkExpr(expr, FLOW_TYPE_ENV, diagnostics), diagnostics };
}

const stubHost: EvalHost = {
    formatDate: (value, tokens) => `[${tokens}:${value.type === 'date' ? value.value : '?'}]`,
};

function evaluate(src: string, props: EvalContext['props'] = {}): Value {
    const { expr, diagnostics } = parseBlock(src);
    if (!expr) throw new Error(`parse failed: ${diagnostics.map(d => d.message).join('; ')}`);
    return evalExpr(expr, {
        props,
        today: '2026-08-15',
        now: { date: '2026-08-15', time: '10:00' },
        weekStartDay: 1,
        host: stubHost,
    });
}

const codes = (ds: Diagnostic[]) => ds.map(d => d.code);

describe('lists in the block profile', () => {
    it('refuses a list and a function in a flow command', () => {
        // フロー行に配列型を持ち込まないための入口の門。ここが開くと
        // 印字器がアロー関数を印字する契約を負う。
        expect(codes(parseFlowExpr('["a", "b"]').diagnostics)).toContain('expr.list-not-here');
        expect(codes(parseFlowExpr('content.map(x => x)').diagnostics)).toContain('expr.function-not-here');
    });

    it('types a list by its elements, and refuses a mixed one', () => {
        expect(check('["a", "b"]').type).toEqual({ array: 'string' });
        expect(check('[1, 2, 3]').type).toEqual({ array: 'number' });
        // 空の配列は「まだ何の配列でもない」= none を底に置く
        expect(check('[]').type).toEqual({ array: 'none' });
        expect(codes(check('[1, "a"]').diagnostics)).toContain('type.list-mixed');
    });

    it('binds the element type to the function parameter', () => {
        expect(check('["a"].map(s => s.length)').type).toEqual({ array: 'number' });
        expect(check('["a"].filter(s => s.includes("x"))').type).toEqual({ array: 'string' });
        expect(check('["a"].map(s => s.length).join(", ")').type).toBe('string');
        // 添字は number、結果は要素型
        expect(check('["a"][0]').type).toBe('string');
        expect(codes(check('["a"]["x"]').diagnostics)).toContain('type.index-not-number');
    });

    it('rejects a function whose answer is the wrong kind', () => {
        expect(codes(check('["a"].filter(s => s.length)').diagnostics)).toContain('type.callback-result');
        expect(codes(check('["a"].map("x")').diagnostics)).toContain('type.expects-function');
        expect(codes(check('["a"].map((a, b, c) => a)').diagnostics)).toContain('type.too-many-params');
    });

    it('says what to use instead of push', () => {
        // 除外した構文は一般的な型エラーで返さない。代替はこの PR で動く
        // ものだけを名指しする（スプレッドは A4-2b）
        const { diagnostics } = check('["a"].push("b")');
        expect(codes(diagnostics)).toContain('type.list-immutable');
        expect(diagnostics[0].message).toContain('concat');
    });

    it('asks for the comparison when sorting anything but text', () => {
        // JS の引数なし sort は要素の文字列を比べるので [10, 9] が並び替わらない。
        // 文字列なら忠実、それ以外は罠なので比較を書かせる。
        expect(check('["b", "a"].sort()').type).toEqual({ array: 'string' });
        expect(codes(check('[2, 10].sort()').diagnostics)).toContain('type.sort-needs-comparator');
        expect(check('[2, 10].sort((a, b) => a - b)').type).toEqual({ array: 'number' });
    });

    it('refuses a parameter that shadows a name the parser already claims', () => {
        // `let` の隠蔽が warning なのに対しこちらは error。引数は要素に触れる
        // 唯一の手段なので、本体から見えない map / filter に正しい読みが無い。
        // しかも黙って通る: filter の述語が定数になって全件素通りする。
        const { diagnostics } = check('["a"].map(content => content)');
        expect(codes(diagnostics)).toContain('type.param-shadows-builtin');
        expect(diagnostics[0].severity).toBe('error');
        expect(codes(check('["a", "bb"].filter(content => content.length > 1)').diagnostics))
            .toContain('type.param-shadows-builtin');
        // 隠していない名前は通る
        expect(check('["a"].map(s => s)').diagnostics).toEqual([]);
    });

    it('keeps the profile of the caller when the parser is re-entered', () => {
        // 入れ子で parseExpr を呼んでも、外側のプロファイルへ戻ること。
        // 戻さないと、ブロックの途中から配列が静かに拒否され始める。
        const { tokens, diagnostics } = tokenize('["a"]');
        parseExpr(new TokenCursor(tokenize('1').tokens), [], 'flow');
        const expr = parseExpr(new TokenCursor(tokens), diagnostics, 'block');
        expect(diagnostics).toEqual([]);
        expect(expr).toMatchObject({ kind: 'array' });
    });

    it('evaluates the list methods', () => {
        expect(evaluate('["a", "bb"].map(s => s.length)')).toEqual({
            type: 'array', items: [{ type: 'number', value: 1 }, { type: 'number', value: 2 }],
        });
        expect(evaluate('["a", "bb"].filter(s => s.length == 2).join("/")')).toEqual({ type: 'string', value: 'bb' });
        expect(evaluate('[1, 2, 3].map((n, i) => n * i)')).toEqual({
            type: 'array',
            items: [{ type: 'number', value: 0 }, { type: 'number', value: 2 }, { type: 'number', value: 6 }],
        });
        expect(evaluate('[3, 1, 2].sort((a, b) => a - b).join(",")')).toEqual({ type: 'string', value: '1,2,3' });
        expect(evaluate('["a", "b"].concat(["c"]).length')).toEqual({ type: 'number', value: 3 });
        expect(evaluate('["a", "b"].includes("b")')).toEqual({ type: 'bool', value: true });
    });

    it('reads past the end as a missing value rather than a failure', () => {
        expect(evaluate('["a"][3] ?? "fallback"')).toEqual({ type: 'string', value: 'fallback' });
        expect(evaluate('["a"][0] ?? "fallback"')).toEqual({ type: 'string', value: 'a' });
    });

    it('leaves the original list alone', () => {
        // 配列は不変。sort が新しい配列を返すことを、元の並びで見る
        expect(evaluate('[3, 1].sort((a, b) => a - b).join(",") + "|" + [3, 1].join(",")'))
            .toEqual({ type: 'string', value: '1,3|3,1' });
    });

    it('does not let a function parameter escape its list method', () => {
        // 束ねるのは呼び出しの内側だけ。外に漏れたら別の式が黙って通る
        const { diagnostics } = check('["a"].map(s => s) == s');
        expect(codes(diagnostics)).toContain('expr.unknown-ident');
    });

    it('keeps the wikilink when brackets collide, and says how to write a nested list', () => {
        // 最長一致で wikilink が勝つ。負けた側に専用の診断を出す
        const { diagnostics } = parseBlock('[[1, 2], [3]]');
        expect(codes(diagnostics)).toContain('lex.wikilink-looks-like-list');
        expect(parseBlock('[ [1, 2], [3] ]').diagnostics).toEqual([]);
        expect(check('[ [1, 2], [3] ]').type).toEqual({ array: { array: 'number' } });
    });
});

describe('the flow profile stays free of lists', () => {
    it('has no built-in whose result is a list', () => {
        // 「配列リテラルを弾く」だけでは足りない。配列を返すスカラのメソッド
        // (split など) を 1 つ足した瞬間に、フロー行へ配列が到達し、印字器が
        // アロー関数を印字する契約を負う。表に足した人がここで止まる。
        const listResults = [
            ...SCALAR_MEMBER_SIGS.map(sig => sig.result),
            ...Object.values(FN_SIGS).map(sig => sig.result),
        ].filter(isArrayType);
        expect(listResults).toEqual([]);
    });
});
