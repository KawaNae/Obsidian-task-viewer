import { describe, it, expect } from 'vitest';
import { parseExpr } from '../../../src/services/lang/ExprParser';
import { printExpr } from '../../../src/services/lang/ExprPrinter';
import { tokenize } from '../../../src/services/lang/Lexer';
import { TokenCursor } from '../../../src/services/lang/Token';

function parse(src: string) {
    const { tokens, diagnostics } = tokenize(src);
    const expr = parseExpr(new TokenCursor(tokens), diagnostics);
    return { expr, diagnostics };
}

/** Print, read back, print again — the shape a flow command survives on. */
function roundTrip(src: string): string {
    const first = parse(src);
    expect(first.diagnostics).toEqual([]);
    const printed = printExpr(first.expr!);
    const second = parse(printed);
    expect(second.diagnostics).toEqual([]);
    expect(printExpr(second.expr!)).toBe(printed);
    return printed;
}

describe('ExprPrinter', () => {
    it('keeps the parentheses ?? needs around || and &&', () => {
        // 混在は構文として禁止したので、この境界の括弧は優先順位では決まらない。
        // 落とすと、エンジンが自分で書いた行を次のスキャンで拒否する。
        expect(roundTrip('(true || false) ?? none')).toBe('(true || false) ?? none');
        expect(roundTrip('(true && false) ?? none')).toBe('(true && false) ?? none');
        expect(roundTrip('none ?? (true || false)')).toBe('none ?? (true || false)');
    });

    it('refuses a chained comparison instead of dropping the rest', () => {
        // 素の parseExpr では `1 == 2 == 3` が診断ゼロで `1 == 2` に化けていた。
        // フロー層で拾えていたのは ')' 期待の網に引っかかっていただけ。
        expect(parse('1 == 2 == 3').diagnostics.map(d => d.code)).toContain('expr.comparison-chain');
        expect(parse('1 < 2 < 3').diagnostics.map(d => d.code)).toContain('expr.comparison-chain');
        expect(roundTrip('(1 == 2) == true')).toBe('(1 == 2) == true');
    });

    // 総当たりのスイープは ExprRoundTrip.test.ts にある。この一覧は
    // 「なぜこの境界に括弧が要るのか」の記録として残す。

    it('keeps precedence parentheses everywhere else', () => {
        expect(roundTrip('today + 1d * 2')).toBe('today + 1d * 2');
        expect(roundTrip('(today + 1d) * 2')).toBe('(today + 1d) * 2');
        expect(roundTrip('true || false && true')).toBe('true || false && true');
        expect(roundTrip('(true || false) && true')).toBe('(true || false) && true');
        expect(roundTrip('time(start) ?? 09:00')).toBe('time(start) ?? 09:00');
        expect(roundTrip('start.format("MM") + "/" + content')).toBe('start.format("MM") + "/" + content');
    });

    // ブロックには文が無いので、そこに { } 本体の関数は書けない。落ちる先が
    // レコードのパーサだと `return` を「フィールド名」と呼んで誤誘導するため、
    // 手前で名指しする。
    it('names a { } function body written outside a js section', () => {
        const { tokens, diagnostics } = tokenize('xs.map(x => { return x })');
        parseExpr(new TokenCursor(tokens), diagnostics, 'block');
        expect(diagnostics.map(d => d.code)).toEqual(['expr.fn-body-not-here']);
    });

    // 印字の契約はフロー行だけのもの。文を持てる形は verbatim なソースにしか
    // 現れないので、canonical 形が無いことを黙って埋めずに言う。
    it('has no canonical form for a block-bodied arrow', () => {
        const { tokens, diagnostics } = tokenize('xs.map(x => { return x })');
        const expr = parseExpr(new TokenCursor(tokens), diagnostics, 'stmt');
        expect(diagnostics).toEqual([]);
        expect(() => printExpr(expr!)).toThrow(/verbatim/);
    });

    it('parenthesizes an assignment wherever an operand is expected', () => {
        const printAs = (src: string): string => {
            const { tokens, diagnostics } = tokenize(src);
            const expr = parseExpr(new TokenCursor(tokens), diagnostics, 'stmt');
            expect(diagnostics).toEqual([]);
            return printExpr(expr!);
        };
        expect(printAs('n = 1')).toBe('n = 1');
        expect(printAs('n += 1')).toBe('n += 1');
        expect(printAs('(n = 1) + 2')).toBe('(n = 1) + 2');
        expect(printAs('[(n = 1)]')).toBe('[(n = 1)]');
    });
});
