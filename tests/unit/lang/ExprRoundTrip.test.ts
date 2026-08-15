import { describe, expect, it } from 'vitest';
import type { Expr } from '../../../src/services/lang/ExprAst';
import { type ParseProfile, parseExpr } from '../../../src/services/lang/ExprParser';
import { printExpr } from '../../../src/services/lang/ExprPrinter';
import { tokenize } from '../../../src/services/lang/Lexer';
import { TokenCursor } from '../../../src/services/lang/Token';

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
 * cases anyone had thought to pin. So the shapes are enumerated here instead,
 * and every operator, literal and postfix form added later is covered on the
 * day it lands. The hand-written cases in `ExprPrinter.test.ts` stay as the
 * record of *why* each boundary needs its parentheses; this file is the net.
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

const BINARY_OPS = ['+', '-', '*', '/', '%', '==', '!=', '<', '<=', '>', '>=', '&&', '||', '??'] as const;

/**
 * A family of sources that share a shape, kept together so the sweep can tell
 * "this family is all fine" from "this family never parsed in the first place".
 * A family that stops being accepted contributes nothing and would otherwise
 * pass in silence.
 */
interface Family { shape: string; sources: string[] }

/** Every pairing of two binary operators, in the ways they can nest. */
const NESTING_FAMILIES: Family[] = [
    'a OP b OP c',
    '(a OP b) OP c',
    'a OP (b OP c)',
    '!(a OP b) OP c',
    '-(a OP b) OP c',
    'a OP b OP c ? d : e',
    'cond ? a OP b : c OP d',
].map(shape => ({ shape, sources: [] as string[] }));

for (const first of BINARY_OPS) {
    for (const second of BINARY_OPS) {
        const forms = [
            `1 ${first} 2 ${second} 3`,
            `(1 ${first} 2) ${second} 3`,
            `1 ${first} (2 ${second} 3)`,
            `!(1 ${first} 2) ${second} 3`,
            `-(1 ${first} 2) ${second} 3`,
            `1 ${first} 2 ${second} 3 ? 4 : 5`,
            `true ? 1 ${first} 2 : 3 ${second} 4`,
        ];
        forms.forEach((src, i) => NESTING_FAMILIES[i].sources.push(src));
    }
}

/** Postfix and call forms, each crossed with every binary operator. */
const POSTFIX_FAMILIES: Family[] = [
    { shape: 'method call', build: (op: string) => `start.format("MM") ${op} content` },
    { shape: 'optional member', build: (op: string) => `start?.weekday ${op} content` },
    { shape: 'method with two args', build: (op: string) => `content.slice(1, 2) ${op} "x"` },
    { shape: 'member', build: (op: string) => `content.length ${op} 2` },
    { shape: 'unit keyword call', build: (op: string) => `startOf(week, today) ${op} start` },
    { shape: 'string-arg call', build: (op: string) => `next("mon", today) ${op} 1d` },
    { shape: 'domain literal call', build: (op: string) => `date("2026-08-17") ${op} 3d` },
    { shape: 'dotted property', build: (op: string) => `tv.file.name ${op} content` },
].map(({ shape, build }) => ({ shape, sources: BINARY_OPS.map(build) }));

/** Literals of every domain type — `valueToLiteral` has to write them back readable. */
const LITERAL_FAMILIES: Family[] = [
    { shape: 'number', sources: ['42', '0'] },
    { shape: 'string', sources: ['"text"', '""', '"quote \\" inside"', '"brace } inside"'] },
    { shape: 'date and time', sources: ['2026-08-17', '2026-08-17T14:00', '14:00', '09:05'] },
    { shape: 'duration', sources: ['3d', '30min', '2mo', '1w', '4y', '6h'] },
    { shape: 'keyword', sources: ['true', 'false', 'none'] },
    { shape: 'wikilink', sources: ['[[Archive]]', '[[folder/note]]'] },
    { shape: 'injected property', sources: ['start', 'end', 'due', 'content', 'done', 'today'] },
];

/**
 * Shapes only a generation block accepts: lists, indexing, and the functions
 * written for them. A flow command cannot reach any of these, so they are not
 * part of what gets re-serialized on firing — but the printer still has to be
 * able to write back what it reads, and this is where that is checked.
 */
const BLOCK_FAMILIES: Family[] = [
    { shape: 'index', sources: BINARY_OPS.map(op => `xs[0] ${op} 1`) },
    { shape: 'list literal', sources: BINARY_OPS.map(op => `[1, 2] ${op} y`) },
    { shape: 'arrow argument', sources: BINARY_OPS.map(op => `xs.map(x => x) ${op} y`) },
    { shape: 'optional index', sources: ['xs?.[0]', 'xs?.[0] ?? "fallback"'] },
    { shape: 'nested list', sources: ['[ [1, 2], [3] ]', '[ [1], [2] ][0]'] },
    { shape: 'list method chain', sources: ['xs.filter(x => x.length > 1).map(x => x.trim()).join(", ")'] },
    { shape: 'two-parameter function', sources: ['xs.map((x, i) => i)', 'xs.sort((a, b) => a - b)'] },
];

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
        const { broken, empty } = sweep(BLOCK_FAMILIES, 'block');
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
            ['block', BLOCK_FAMILIES],
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
