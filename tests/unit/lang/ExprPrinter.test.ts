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

    /**
     * Both defects found so far were the same illness: the printer's levels
     * and the parser's associativity disagreeing. A hand-written case only
     * covers the shape someone thought of, while this grows on its own as
     * operators are added.
     */
    it('round-trips every accepted pairing of binary operators', () => {
        const ops = ['+', '-', '*', '/', '%', '==', '!=', '<', '<=', '>', '>=', '&&', '||', '??'];
        let checked = 0;
        for (const first of ops) {
            for (const second of ops) {
                for (const src of [
                    `1 ${first} 2 ${second} 3`,
                    `(1 ${first} 2) ${second} 3`,
                    `1 ${first} (2 ${second} 3)`,
                    `!(1 ${first} 2) ${second} 3`,
                    `1 ${first} 2 ${second} 3 ? 4 : 5`,
                ]) {
                    const parsed = parse(src);
                    // 受理しない形はこの契約の対象外（拒否は拒否で正しい）
                    if (parsed.diagnostics.length > 0 || !parsed.expr) continue;
                    const printed = printExpr(parsed.expr);
                    const again = parse(printed);
                    expect(again.diagnostics, `${src} → ${printed}`).toEqual([]);
                    expect(printExpr(again.expr!), `${src} → ${printed}`).toBe(printed);
                    checked++;
                }
            }
        }
        // 網が空になっていないこと（受理形がゼロだと素通りする）
        expect(checked).toBeGreaterThan(300);
    });

    it('keeps precedence parentheses everywhere else', () => {
        expect(roundTrip('today + 1d * 2')).toBe('today + 1d * 2');
        expect(roundTrip('(today + 1d) * 2')).toBe('(today + 1d) * 2');
        expect(roundTrip('true || false && true')).toBe('true || false && true');
        expect(roundTrip('(true || false) && true')).toBe('(true || false) && true');
        expect(roundTrip('time(start) ?? 09:00')).toBe('time(start) ?? 09:00');
        expect(roundTrip('start.format("MM") + "/" + content')).toBe('start.format("MM") + "/" + content');
    });
});
