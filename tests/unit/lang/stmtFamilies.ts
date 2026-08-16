/**
 * The statement corpus, for the differential sweep of the js section.
 *
 * Kept apart from `exprFamilies.ts` on purpose. That file feeds two nets —
 * printing and meaning — and says so; a block is verbatim source with no
 * canonical form, so statements have no printing contract to measure. Mixing
 * them would leave "every family here is measured by both nets" half true,
 * and a half-true invariant is worse than two files.
 *
 * Control structures are the same shape as JS, so the value is not in `if`
 * and `for` themselves. It is where the language's own decisions meet them:
 * decimal arithmetic repeated in a loop, an assignment that is an expression,
 * the order a classic `for` runs its update, a short-circuit that must not
 * evaluate the write on its right.
 */

export interface StmtSource {
    /** Statements. They produce no value. */
    setup: string;
    /** One expression, read against the scope the statements left. */
    read: string;
    /**
     * Top-level names the read deliberately does not look at.
     *
     * Declared rather than tolerated: a `read` that misses a binding the
     * `setup` moved reports agreement about something it never looked at,
     * which is the quietest way a differential corpus dies.
     */
    unread?: string[];
}

export interface StmtFamily { shape: string; sources: StmtSource[] }

/**
 * Names the corpus must not declare at the top level.
 *
 * They arrive as parameters on the JS side, and JS refuses a body-level `let`
 * over a parameter while this language reads it as an ordinary shadow. The
 * sweep asserts this rather than trusting the list to stay observed.
 */
export const STATEMENT_FAMILIES: StmtFamily[] = [
    {
        shape: 'accumulate',
        sources: [
            { setup: 'let total = 0\nfor (const v of ns) { total = total + v }', read: 'total' },
            { setup: 'let total = 0\nfor (const v of ns) { total += v * 2 }', read: 'total' },
            // 10 進の量子化が反復で積もらないこと。1 回ずつでは見えない。
            { setup: 'let total = 0\nfor (const v of ns) { total = total + 0.1 }', read: 'total' },
            { setup: 'let total = 1\nlet i = 0\nwhile (i < 3) { total = total * 2\ni = i + 1 }', read: 'total + i' },
        ],
    },
    {
        shape: 'accumulate through division',
        sources: [
            // 商が文をまたいで運ばれる形。1 文なら格子で比べられるが、ここは
            // 合成された除算なので比較の対象外になる（ずれ 2 そのもの）。
            { setup: 'let acc = 100\nfor (const v of ns) { acc = acc / v }', read: 'acc' },
            { setup: 'let half = n / 2\nlet twice = half * 2', read: 'twice', unread: ['half'] },
        ],
    },
    {
        shape: 'build a string',
        sources: [
            { setup: 'let text = ""\nfor (const v of xs) { text = text + v }', read: 'text' },
            { setup: 'let text = ""\nfor (const v of xs) { text += v.toUpperCase() }', read: 'text' },
            { setup: 'let text = a\ntext = text + b + name', read: 'text' },
        ],
    },
    {
        shape: 'accumulate into a list',
        sources: [
            { setup: 'let out = []\nfor (const v of xs) { out = [...out, v] }', read: 'out.join(",")' },
            { setup: 'let out = []\nfor (const v of ns) { out = out.concat([v * 2]) }', read: 'out.join("-")' },
            // 不変配列。元の束縛が動いていないことは sweep が別に見る。
            { setup: 'let out = xs.concat(["d"])', read: 'out.join(",")' },
        ],
    },
    {
        shape: 'branch',
        sources: [
            {
                setup: 'let label = ""\nif (n > 2) { label = a } else if (n > 1) { label = b } else { label = name }',
                read: 'label',
            },
            { setup: 'let label = ""\nif (flag) { label = a } else { label = b }', read: 'label' },
            {
                setup: 'let depth = 0\nif (n > 1) { if (y > 1) { depth = 2 } else { depth = 1 } }',
                read: 'depth',
            },
        ],
    },
    {
        shape: 'loop control',
        sources: [
            {
                setup: 'let text = ""\nfor (const v of xs) { if (v == "bb") { continue }\ntext = text + v }',
                read: 'text',
            },
            {
                setup: 'let text = ""\nfor (const v of xs) { if (v == "bb") { break }\ntext = text + v }',
                read: 'text',
            },
            {
                setup: 'let hits = 0\nfor (const v of ns) { if (v == 1) { break }\nhits = hits + 1 }',
                read: 'hits',
            },
        ],
    },
    {
        shape: 'scope',
        sources: [
            { setup: 'let outer = a\n{ let inner = b\nouter = outer + inner }', read: 'outer' },
            // ブロックの中の宣言は外を隠すだけで、外の値は残る。
            { setup: 'let shadowed = a\n{ let shadowed = b }', read: 'shadowed' },
            {
                setup: 'let seen = ""\nfor (const v of xs) { let each = v\nseen = seen + each }',
                read: 'seen',
            },
        ],
    },
    {
        shape: 'functions',
        sources: [
            { setup: 'const twice = v => v + v\nlet r = twice(a)', read: 'r' },
            { setup: 'const pick = (p, q) => p + q\nlet r = pick(a, b)', read: 'r' },
            { setup: 'const grow = v => { let m = v * 2\nreturn m + 1 }\nlet r = grow(n)', read: 'r' },
            // クロージャは宣言時ではなく呼び出し時の値を見る。
            { setup: 'let base = 1\nconst add = v => v + base\nbase = 10\nlet r = add(5)', read: 'r + base' },
        ],
    },
    {
        shape: 'the value an assignment yields',
        sources: [
            // 設計が「${n = n + 1} で off-by-one が構造的に起きない」と言って
            // いる当のもの。JS と一致することがその主張の根拠になる。
            { setup: 'let c = 3', read: '(c += 1) + c' },
            { setup: 'let c = 3', read: '(c = c + 1) + c' },
            { setup: 'let c = 3\nlet d = (c += 1)', read: 'c + d' },
            { setup: 'let c = 3\nlet d = 0\nd = (c -= 1)', read: 'c + d' },
        ],
    },
    {
        shape: 'the order a classic for runs',
        sources: [
            // update は body の後。continue でも走る。
            {
                setup: 'let seq = ""\nfor (let i = 0; i < 3; i += 1) { if (i == 1) { continue }\nseq = seq + xs[i] }',
                read: 'seq',
            },
            {
                setup: 'let last = 0\nfor (let i = 0; i < 3; i += 1) { last = i }',
                read: 'last',
            },
            {
                setup: 'let seq = ""\nfor (let i = 0; i < 3; i += 1) { if (i == 1) { break }\nseq = seq + xs[i] }',
                read: 'seq',
            },
        ],
    },
    {
        shape: 'short circuit and assignment',
        sources: [
            // 短絡した側の代入は起きない。代入が式になったことで新しく踏める形。
            // read は touched と r の両方を見る。片方だけだと、短絡の結果は
            // 合っているのに書き込みだけがずれている形を素通りさせる。
            { setup: 'let touched = false\nconst r = false && (touched = true)', read: '[touched, r].filter(v => v).length' },
            { setup: 'let touched = false\nconst r = true && (touched = true)', read: '[touched, r].filter(v => v).length' },
            { setup: 'let touched = false\nconst r = true || (touched = true)', read: '[touched, r].filter(v => v).length' },
            { setup: 'let touched = false\nconst r = false || (touched = true)', read: '[touched, r].filter(v => v).length' },
        ],
    },
    {
        shape: 'destructuring lines up',
        sources: [
            { setup: 'const [p, , q] = ns', read: '[p, q].join(",")' },
            { setup: 'const [p, q] = ys', read: 'p + q' },
            { setup: 'const {u, v: w} = {u: 1, v: 2}', read: 'u + w' },
            // 値が足りないところは none / undefined。両側で同じ形になる。
            { setup: 'const [p, q, r2, s2] = ys', read: '[p, q, r2, s2].join(",")' },
        ],
    },
];
