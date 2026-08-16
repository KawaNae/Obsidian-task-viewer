import { describe, it, expect } from 'vitest';
import type { Diagnostic } from '../../../src/services/lang/Diagnostic';
import { parseFlow } from '../../../src/services/flow/FlowParser';
import type { Expr } from '../../../src/services/lang/ExprAst';
import { parseExpr } from '../../../src/services/lang/ExprParser';
import { printExpr } from '../../../src/services/lang/ExprPrinter';
import { tokenize } from '../../../src/services/lang/Lexer';
import { parseProgram } from '../../../src/services/lang/StmtParser';
import { TokenCursor } from '../../../src/services/lang/Token';

function parseBlock(src: string): { expr: Expr | null; diagnostics: Diagnostic[] } {
    const { tokens, diagnostics } = tokenize(src);
    const expr = parseExpr(new TokenCursor(tokens), diagnostics, 'block');
    return { expr, diagnostics };
}

/** Parse in the block profile and require a clean read. */
function ok(src: string): Expr {
    const { expr, diagnostics } = parseBlock(src);
    expect(diagnostics).toEqual([]);
    return expr!;
}

/**
 * A comma sitting right before the closer.
 *
 * Every JS formatter writes one there, and anyone editing a list down the
 * page leaves one behind, so refusing it would be refusing the shape this
 * language is imitating. Only the trailing one: a hole in the middle
 * (`[1, , 2]`) is a JS wart this language does not have.
 */
describe('a trailing comma', () => {
    it('ends a list', () => {
        expect(ok('[1, 2,]')).toMatchObject({ kind: 'array', items: [{}, {}] });
        expect(ok('[1,]')).toMatchObject({ kind: 'array', items: [{}] });
        expect(ok('[\n1,\n2,\n]')).toMatchObject({ kind: 'array', items: [{}, {}] });
    });

    it('ends a record', () => {
        expect(ok('{a: 1, b: 2,}')).toMatchObject({ kind: 'record', entries: [{}, {}] });
        expect(ok('{\n a: 1,\n b: 2,\n}')).toMatchObject({ kind: 'record', entries: [{}, {}] });
    });

    it('ends an argument list', () => {
        expect(ok('Math.max(1, 2,)')).toMatchObject({ kind: 'call', args: [{}, {}] });
        expect(ok('["a"].join("-",)')).toMatchObject({ kind: 'method', args: [{}] });
    });

    it('ends a parameter list', () => {
        expect(ok('["a"].map((x, i,) => x)')).toMatchObject({
            kind: 'method', args: [{ kind: 'arrow', params: ['x', 'i'] }],
        });
    });

    it('ends a destructuring pattern', () => {
        const { program, diagnostics } = parseProgram('let [a, b,] = xs\nlet {c, d,} = r');
        expect(diagnostics).toEqual([]);
        expect(program.body).toMatchObject([
            { target: { kind: 'array-pattern', names: [{ name: 'a' }, { name: 'b' }] } },
            { target: { kind: 'record-pattern', fields: [{ key: 'c' }, { key: 'd' }] } },
        ]);
    });

    // 末尾だけ。真ん中の穴は JS の癖であって、この言語には無い。
    it('is not a hole in the middle', () => {
        expect(parseBlock('[1, , 2]').diagnostics.map(d => d.code)).toEqual(['expr.unexpected-token']);
        expect(parseBlock('Math.max(1, , 2)').diagnostics.map(d => d.code)).toEqual(['expr.unexpected-token']);
    });

    it('is not an empty list on its own', () => {
        expect(parseBlock('[,]').diagnostics.map(d => d.code)).toEqual(['expr.unexpected-token']);
    });

    // フロー行は発火のたびに canonical へ印字し直される。受理しても印字は
    // 末尾カンマ無しに正規化されるので、往復は保たれる。
    it('survives a flow clause and prints without one', () => {
        const { program, diagnostics } = parseFlow('every mon setContent(format(start, "MM",))');
        expect(diagnostics).toEqual([]);
        expect(printExpr(program!.sets!.content!.expr)).toBe('format(start, "MM")');
    });
});
