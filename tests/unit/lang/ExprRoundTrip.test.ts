import { describe, expect, it } from 'vitest';
import type { Expr } from '../../../src/services/lang/ExprAst';
import { FLOW_TYPE_ENV, checkExpr } from '../../../src/services/lang/ExprChecker';
import { type ParseProfile, parseExpr } from '../../../src/services/lang/ExprParser';
import { printExpr } from '../../../src/services/lang/ExprPrinter';
import { tokenize } from '../../../src/services/lang/Lexer';
import { TokenCursor } from '../../../src/services/lang/Token';
import {
    BLOCK_FAMILIES, DIFFERENTIAL_FAMILIES, type Family, LITERAL_FAMILIES, NESTING_FAMILIES,
    POSTFIX_FAMILIES,
} from './exprFamilies';

/**
 * The parser and printer are a pair, swept rather than pinned.
 *
 * A flow command is re-serialized on every firing, so `parse(print(e))` has to
 * give back `e`. Break it and the engine hands the next scan a line it wrote
 * itself and can no longer read — the task stops firing, and nothing in the
 * vault looks wrong.
 *
 * Both breaks found so far were the same illness — the printer's precedence
 * levels disagreeing with the parser's grammar — and neither was among the
 * cases anyone had thought to pin. So the shapes are enumerated instead
 * (`exprFamilies.ts`, shared with the differential sweep), and every operator,
 * literal and postfix form added later is covered on the day it lands. The
 * hand-written cases in `ExprPrinter.test.ts` stay as the record of *why* each
 * boundary needs its parentheses; this file is the net.
 */

function parse(src: string, profile: ParseProfile = 'flow') {
    const { tokens, diagnostics } = tokenize(src);
    const cursor = new TokenCursor(tokens);
    const expr = parseExpr(cursor, diagnostics, profile);
    // Whether the parser reached the end of the input. It reads one expression
    // and stops, so leftover tokens mean part of what the user wrote was
    // dropped. Round-tripping cannot see that: the half that was read prints
    // and reads back perfectly well.
    return { expr, diagnostics, readToEnd: cursor.at('eof') };
}

/** The same expression twice, minus source positions — those differ by construction. */
function withoutSpans(node: unknown): unknown {
    if (Array.isArray(node)) return node.map(withoutSpans);
    if (node === null || typeof node !== 'object') return node;
    return Object.fromEntries(
        Object.entries(node as Record<string, unknown>)
            .filter(([key]) => key !== 'span')
            .map(([key, value]) => [key, withoutSpans(value)]),
    );
}

/**
 * Print it, read it back, and compare the trees.
 *
 * Structural equality rather than "prints the same again": an expression that
 * reads back as something else is already broken, even in the rare case where
 * the something else happens to print identically.
 */
function survivesRoundTrip(expr: Expr, profile: ParseProfile = 'flow'): { ok: boolean; detail: string } {
    const printed = printExpr(expr);
    const again = parse(printed, profile);
    if (again.diagnostics.length > 0 || !again.expr) {
        const codes = again.diagnostics.map(d => d.code).join(', ');
        return { ok: false, detail: `printed as "${printed}", which no longer parses (${codes})` };
    }
    if (JSON.stringify(withoutSpans(again.expr)) !== JSON.stringify(withoutSpans(expr))) {
        return { ok: false, detail: `printed as "${printed}", which reads back as "${printExpr(again.expr)}"` };
    }
    return { ok: true, detail: printed };
}

function sweep(families: Family[], profile: ParseProfile = 'flow'): { broken: string[]; empty: string[] } {
    const broken: string[] = [];
    const empty: string[] = [];
    for (const family of families) {
        let accepted = 0;
        for (const src of family.sources) {
            const parsed = parse(src, profile);
            // 受理しない形はこの契約の対象外（拒否は拒否で正しい）
            if (parsed.diagnostics.length > 0 || !parsed.expr) continue;
            accepted++;
            const result = survivesRoundTrip(parsed.expr, profile);
            if (!result.ok) broken.push(`${src} — ${result.detail}`);
        }
        // 網が空になっていないこと。受理形がゼロの family は素通りするので、
        // 文法が変わってこの形が読めなくなったら失敗として出す
        if (accepted === 0) empty.push(family.shape);
    }
    return { broken, empty };
}

describe('expression round-trip sweep', () => {
    it('prints every accepted operator pairing so that it reads back the same', () => {
        const { broken, empty } = sweep(NESTING_FAMILIES);
        expect(broken).toEqual([]);
        expect(empty).toEqual([]);
    });

    it('prints every accepted postfix and call form so that it reads back the same', () => {
        const { broken, empty } = sweep(POSTFIX_FAMILIES);
        expect(broken).toEqual([]);
        expect(empty).toEqual([]);
    });

    it('prints every literal so that it reads back the same', () => {
        const unreadable = LITERAL_FAMILIES.flatMap(family => family.sources
            .filter(src => {
                const parsed = parse(src);
                return parsed.diagnostics.length > 0 || !parsed.expr;
            })
            .map(src => `${src} — does not parse`));
        // リテラルは 1 つ残らず受理される想定なので、skip ではなく失敗にする
        expect(unreadable).toEqual([]);

        const { broken } = sweep(LITERAL_FAMILIES);
        expect(broken).toEqual([]);
    });

    it('prints every accepted block-only shape so that it reads back the same', () => {
        const { broken, empty } = sweep([...BLOCK_FAMILIES, ...DIFFERENTIAL_FAMILIES], 'block');
        expect(broken).toEqual([]);
        expect(empty).toEqual([]);
    });

    it('reads every accepted shape to the end, or says why not', () => {
        // 往復では見えない契約。入力の一部を黙って落としても、読めた分は
        // きれいに往復する。`1 == 2 == 3` がまさにそれで、フロー層の
        // ') が必要' に引っかかっていただけだった。差し込みはその網の外に出る。
        const dropped: string[] = [];
        for (const [profile, families] of [
            ['flow', [...NESTING_FAMILIES, ...POSTFIX_FAMILIES, ...LITERAL_FAMILIES]],
            ['block', [...BLOCK_FAMILIES, ...DIFFERENTIAL_FAMILIES]],
        ] as [ParseProfile, Family[]][]) {
            for (const src of families.flatMap(f => f.sources)) {
                const parsed = parse(src, profile);
                if (parsed.diagnostics.length > 0 || !parsed.expr) continue; // 診断を出して止まるのは正しい
                if (!parsed.readToEnd) dropped.push(`${src} — read only "${printExpr(parsed.expr)}"`);
            }
        }
        expect(dropped).toEqual([]);
    });
});

/**
 * Block-only shapes, written with operands a flow command accepts, so that the
 * only thing able to refuse them is the gate itself. An unknown name would
 * refuse them for the wrong reason and the check would pass on its own.
 *
 * The gate is what keeps the printer's vocabulary closed: a shape that becomes
 * expressible in a flow command also becomes something the printer has to
 * write back readably on every firing.
 */
const FLOW_GATE_SOURCES = [
    '[1, 2]',
    '[1, 2][0]',
    '[content, content]',
    '[1, 2] + 3',
    '[ [1], [2] ]',
    '["a"].map(x => x)',
    '["a"].filter(x => x.length > 0).join(", ")',
    'x => x',
    '(a, b) => a',
    'content[0]',
];

describe('the flow profile cannot express a block shape', () => {
    it('refuses every block-only shape, by the parser or the checker', () => {
        const accepted: string[] = [];
        for (const src of FLOW_GATE_SOURCES) {
            const parsed = parse(src, 'flow');
            const diagnostics = [...parsed.diagnostics];
            // パーサと型検査を通して初めて「フロー行が書けない」と言える。
            // 添字はパーサでは通り、受け手が配列でないことで落ちる
            if (parsed.expr) checkExpr(parsed.expr, FLOW_TYPE_ENV, diagnostics);
            if (diagnostics.length === 0) accepted.push(src);
        }
        expect(accepted).toEqual([]);
    });

    it('still parses each of them as a block shape, so the list cannot rot', () => {
        // 上の検査は「拒否されること」しか見ないので、綴りを間違えた行でも通る。
        // ブロックでは読めることを併せて見て、意味のある形であり続けさせる
        const unreadable = FLOW_GATE_SOURCES
            .filter(src => {
                const parsed = parse(src, 'block');
                return parsed.diagnostics.length > 0 || !parsed.expr;
            });
        expect(unreadable).toEqual([]);
    });
});
