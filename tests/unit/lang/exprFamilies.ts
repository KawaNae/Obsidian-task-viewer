/**
 * The expression corpus, shared by the sweeps.
 *
 * One list of families feeds two nets: the round-trip sweep
 * (`ExprRoundTrip.test.ts`, the printing contract) and the differential sweep
 * (`ExprDifferential.test.ts`, the meaning contract against native JS). A
 * family added here widens both at once — the corpus cannot be right in one
 * net and missing from the other.
 */

/**
 * A family of sources that share a shape, kept together so a sweep can tell
 * "this family is all fine" from "this family never parsed in the first
 * place". A family that stops being accepted contributes nothing and would
 * otherwise pass in silence.
 */
export interface Family { shape: string; sources: string[] }

/** Written out so the escape in the template family reads as what it is. */
const BACKSLASH = '\\';

export const BINARY_OPS = ['+', '-', '*', '/', '%', '==', '!=', '<', '<=', '>', '>=', '&&', '||', '??'] as const;

/** Every pairing of two binary operators, in the ways they can nest. */
export const NESTING_FAMILIES: Family[] = [
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
export const POSTFIX_FAMILIES: Family[] = [
    { shape: 'method call', build: (op: string) => `start.format("MM") ${op} content` },
    { shape: 'optional member', build: (op: string) => `start?.weekday ${op} content` },
    { shape: 'method with two args', build: (op: string) => `content.slice(1, 2) ${op} "x"` },
    { shape: 'member', build: (op: string) => `content.length ${op} 2` },
    { shape: 'unit keyword call', build: (op: string) => `startOf(week, today) ${op} start` },
    { shape: 'string-arg call', build: (op: string) => `next("mon", today) ${op} 1d` },
    { shape: 'domain literal call', build: (op: string) => `date("2026-08-17") ${op} 3d` },
    { shape: 'dotted property', build: (op: string) => `tv.file.name ${op} content` },
    { shape: 'namespaced call', build: (op: string) => `Math.floor(3 / 2) ${op} 1` },
    { shape: 'variadic call', build: (op: string) => `Math.max(1, 2, 3) ${op} 1` },
].map(({ shape, build }) => ({ shape, sources: BINARY_OPS.map(build) }));

/** Literals of every domain type — `valueToLiteral` has to write them back readable. */
export const LITERAL_FAMILIES: Family[] = [
    { shape: 'number', sources: ['42', '0'] },
    // 固定小数点の往復が要点: String(1e-7) は指数表記になり字句が読み戻せない
    { shape: 'decimal number', sources: ['0.5', '0.1', '0.0000001', '500000.5', '0.3333333333'] },
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
export const BLOCK_FAMILIES: Family[] = [
    { shape: 'index', sources: BINARY_OPS.map(op => `xs[0] ${op} 1`) },
    { shape: 'list literal', sources: BINARY_OPS.map(op => `[1, 2] ${op} y`) },
    { shape: 'arrow argument', sources: BINARY_OPS.map(op => `xs.map(x => x) ${op} y`) },
    { shape: 'optional index', sources: ['xs?.[0]', 'xs?.[0] ?? "fallback"'] },
    { shape: 'nested list', sources: ['[ [1, 2], [3] ]', '[ [1], [2] ][0]'] },
    { shape: 'list method chain', sources: ['xs.filter(x => x.length > 1).map(x => x.trim()).join(", ")'] },
    { shape: 'two-parameter function', sources: ['xs.map((x, i) => i)', 'xs.sort((a, b) => a - b)'] },
    { shape: 'record literal', sources: BINARY_OPS.map(op => `{a: 1, b: "x"} ${op} y`) },
    {
        shape: 'record read',
        sources: ['{a: 1}.a', '{a: 1}["a"]', '{a: 1, b: 2}[key]', '{}', '{"a b": 1}["a b"]'],
    },
    {
        shape: 'spread',
        sources: ['[...xs]', '[...xs, y]', '[a, ...xs, b]', '[...xs, ...ys]'],
    },
    {
        shape: 'template literal',
        sources: [
            '`plain text`',
            '`第${n}回`',
            '`${a} between ${b}`',
            // エスケープした差し込みは、印字して読み直してもリテラルのまま
            '`path C:' + BACKSLASH + BACKSLASH + '${name}`',
            '`${xs.map(x => `in ${x}`).join("")}`',
        ],
    },
];

/**
 * Sources written for the differential sweep: every free name is bound by its
 * binding table, and the shapes stay inside the JS-comparable subset (integer
 * arithmetic, strings, lists, records, Math, templates). They join the block
 * round-trip sweep too — a shape worth comparing is a shape worth printing.
 */
export const DIFFERENTIAL_FAMILIES: Family[] = [
    {
        shape: 'integer arithmetic on bindings',
        sources: ['n + y * 2', '-n + 7', '(n + y) % 3', 'n * n - y', '(n - y) * (n + y)'],
    },
    {
        shape: 'string members',
        sources: ['s.length + n', 's.slice(0, 5)', 's.slice(n)', 's.trim()', 's.includes("lo")'],
    },
    {
        shape: 'list building',
        sources: ['[...ns, 4].join("-")', 'ns.concat([9]).length', 'ns.filter(x => x > 1)', 'ns.map(x => x * 2)'],
    },
    {
        shape: 'list reading',
        sources: ['ns[0] + ns[1]', 'ns[9] ?? 0', 'xs.join("/")', 'xs[n] ?? "out"'],
    },
    {
        shape: 'record tables',
        sources: [
            '{mon: "a", tue: "b"}[key2] ?? "other"',
            '{a: 1}.a + 1',
            '{a: n, b: y}[key] * 10',
            '{a: 1}["b"] ?? 0',
        ],
    },
    {
        shape: 'optional and fallback',
        sources: ['xs?.[0] ?? "f"', 'none ?? "f"', 'ns?.[1] + 1'],
    },
    {
        shape: 'ternary and logic',
        sources: ['n > 2 ? "big" : "small"', 'flag && n == 3', '!(flag || false)', 'n != y == flag'],
    },
    {
        shape: 'sort stays a copy',
        sources: ['ns.sort((a, b) => a - b)', 'ns.sort((a, b) => b - a).join(",")'],
    },
    {
        shape: 'division grid',
        sources: ['1 / 3', 'n / y', '10 % 3', '7 / 2 + 1', '1 / 3 * 3'],
    },
    {
        // Deviation #1 made concrete: these sit behind the decimal predicate
        // today, and deleting that predicate row puts them in front of the
        // differential net — where each one disagrees with native JS by
        // design (0.1 + 0.2 is 0.3 here, and % follows the quantized
        // quotient). The round-trip net reads them from day one.
        shape: 'decimal grid',
        sources: [
            '0.1 + 0.2', '0.1 * 3', '0.1 + 0.2 == 0.3', '1.1 - 1',
            '0.3 % 0.1', '1.5 % 0.4', 'n + 0.5', '(0.1 + 0.2) * 10',
        ],
    },
    {
        shape: 'Math helpers',
        sources: [
            'Math.floor(7 / 2)', 'Math.ceil(n / y)', 'Math.round(7 / y)',
            'Math.floor(n * y)', 'Math.min(n, y, 10)', 'Math.max(0 - n, y)', 'Math.abs(0 - n)',
        ],
    },
    {
        shape: 'template building',
        sources: ['`x${n}y`', '`${xs.join("")}!`', '`${n > y ? "hi" : "lo"}`'],
    },
];
