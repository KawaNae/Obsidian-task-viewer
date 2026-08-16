import { describe, it, expect } from 'vitest';
import en from '../../../src/i18n/locales/en.json';
import ja from '../../../src/i18n/locales/ja.json';
import { diagnosticText } from '../../../src/services/flow/diagnosticText';
import { parseFlow } from '../../../src/services/flow/FlowParser';
import { Diagnostic } from '../../../src/services/lang/Diagnostic';
import { FLOW_TYPE_ENV, checkExpr } from '../../../src/services/lang/ExprChecker';
import { parseExpr, splitInterpolations } from '../../../src/services/lang/ExprParser';
import { tokenize } from '../../../src/services/lang/Lexer';
import { checkProgram } from '../../../src/services/lang/StmtChecker';
import { parseProgram } from '../../../src/services/lang/StmtParser';
import { TokenCursor } from '../../../src/services/lang/Token';
import { parseGenBody } from '../../../src/services/parsing/gen/GenBodyParser';

/** Whether `flowDiag.<family>.<name>` is actually spelled out in a locale. */
function hasLocaleEntry(locale: unknown, code: string): boolean {
    const dot = code.indexOf('.');
    const family = (locale as { flowDiag?: Record<string, Record<string, string>> })
        .flowDiag?.[code.slice(0, dot)];
    return typeof family?.[code.slice(dot + 1)] === 'string';
}

describe('diagnosticText', () => {
    it('renders the locale template with params interpolated', () => {
        // Default locale in tests is en; the en template must render params
        const { diagnostics } = parseFlow('tue every');
        const unknownHead = diagnostics.find(d => d.code === 'flow.unknown-head');
        expect(unknownHead).toBeDefined();
        const text = diagnosticText(unknownHead!);
        expect(text).toContain("'tue'");
        expect(text).not.toContain('{{');
    });

    it('covers every emitted diagnostic code with a locale entry', () => {
        // Representative sample across lex / expr / type / flow families
        const samples = [
            'garbage',                          // flow.unknown-head
            'every mon at(today + 3d)',         // flow.duplicate-schedule
            'at(today + 1d) x5 x3',             // flow.duplicate-node
            'x5',                               // flow.orphan-modifier
            'every mon until 2026-02-30',       // flow.expected-lparen
            'at("text")',                       // type.at-not-datish
            'every mon setDue("x")',           // type.set-date-mismatch
            'every mon setContent(start + due)', // type.cannot-combine
            'at(startOf("day"))',               // type.bad-unit-keyword
            'at(starrt)',                       // expr.unknown-ident
            'at(Math)',                         // expr.namespace-needs-member
            'at(Math.sqrt(4))',                 // expr.unknown-property
            'at(Math.floor)',                   // expr.expected-call
            'at(Math.floor(1, 2))',             // type.arg-count
            'at(format(start))',                // type.arg-count
            '+3x',                              // lex.unknown-unit
            'every mon setStartTime("x")',     // type.set-time-mismatch
            'every mon until("text")',          // type.until-not-datish
            'at(next(tue))',                    // expr.weekday-not-literal
            'at(next("monday"))',               // type.bad-weekday-name
            'every mon setStartTime(time(start) ?? 3)', // type.nullish-mismatch
            'every mon setContent(start.format())', // type.member-arity
            'every mon setContent(start.nope)',  // type.unknown-member
            'every mon setContent(content.slice("a"))', // type.member-arg
            'at(today + 0.5d)',                 // lex.decimal-duration
            'at(0.00000000001)',                // lex.decimal-too-precise
            'at(600000.0000000004)',            // lex.decimal-too-large
            'every mon setContent(true || false ?? none)', // expr.nullish-mixed-with-logic
            'every mon setContent(content == "a" == true)', // expr.comparison-chain
        ];
        const seen = new Set<string>();
        for (const src of samples) {
            for (const d of parseFlow(src).diagnostics) {
                seen.add(d.code);
                const text = diagnosticText(d);
                // Never leak the raw key or unfilled placeholders
                expect(text).not.toMatch(/^flowDiag\./);
                expect(text).not.toContain('{{');
            }
        }
        // 追加した診断が実際に出ていること（サンプルが陳腐化すると気づけない）
        for (const code of ['expr.namespace-needs-member', 'expr.expected-call',
            'expr.weekday-not-literal', 'type.bad-weekday-name',
            'type.nullish-mismatch', 'type.member-arity', 'type.unknown-member',
            'type.member-arg', 'lex.decimal-duration', 'lex.decimal-too-precise',
            'lex.decimal-too-large', 'expr.nullish-mixed-with-logic', 'expr.comparison-chain']) {
            expect(seen).toContain(code);
        }
    });

    it('covers the block-only codes too', () => {
        // 生成ブロックの診断は parseFlow からは出ない。フロー行の網に載らない
        // ぶん、ここで別に通す。
        const samples = [
            '[1, "a"]',                       // type.list-mixed
            '["a"]["x"]',                     // type.index-not-number
            'content[0]',                     // type.not-indexable
            '["a"].push("b")',                // type.list-immutable
            '[2, 10].sort()',                 // type.sort-needs-comparator
            '["a"].map("x")',                 // type.expects-function
            '["a"].filter(s => s.length)',    // type.callback-result
            '["a"].map((a, b, c) => a)',      // type.too-many-params
            '["a"].map(content => content)',  // type.param-shadows-builtin
            'x => x',                         // type.function-not-here
            'xs[0',                           // expr.expected-rbracket
            '["a"',                           // expr.expected-rbracket-list
            '(1) => 1',                       // expr.expected-param
            '[[1, 2], [3]]',                  // lex.wikilink-looks-like-list
            '`unterminated',                  // lex.unterminated-template
            '{1: "a"}',                       // expr.expected-field-name
            '{a 1}',                          // expr.expected-field-value
            '{a: 1',                          // expr.expected-rbrace
            '...["a"]',                       // expr.spread-not-here
            '{a: 1}.b',                       // type.unknown-field
            '{a: 1}[0]',                      // type.index-not-string
            '{a: 1, b: "x"}[content]',        // type.record-fields-differ
            '[...content]',                   // type.spread-not-a-list
        ];
        const seen = new Set<string>();
        for (const src of samples) {
            const { tokens, diagnostics } = tokenize(src);
            const expr = parseExpr(new TokenCursor(tokens), diagnostics, 'block');
            if (expr) checkExpr(expr, FLOW_TYPE_ENV, diagnostics);
            for (const d of diagnostics) {
                seen.add(d.code);
                const text = diagnosticText(d);
                expect(text).not.toMatch(/^flowDiag\./);
                expect(text).not.toContain('{{');
            }
        }
        for (const code of ['type.list-mixed', 'type.index-not-number', 'type.not-indexable',
            'type.list-immutable', 'type.sort-needs-comparator', 'type.expects-function',
            'type.callback-result', 'type.too-many-params', 'type.param-shadows-builtin',
            'type.function-not-here', 'expr.expected-rbracket', 'expr.expected-rbracket-list',
            'expr.expected-param',
            'lex.wikilink-looks-like-list', 'lex.unterminated-template',
            'expr.expected-field-name', 'expr.expected-field-value', 'expr.expected-rbrace',
            'expr.spread-not-here', 'type.unknown-field', 'type.index-not-string',
            'type.record-fields-differ', 'type.spread-not-a-list']) {
            expect(seen).toContain(code);
        }
        // フロー側で弾く 2 つも、文言が出ること
        const flowOnly = [
            'every mon setContent(["a"])',
            'every mon setContent(content.map(x => x))',
            'every mon setContent(`第${1}回`)',
            'every mon setContent({a: 1})',
        ];
        for (const src of flowOnly) {
            for (const d of parseFlow(src).diagnostics) {
                expect(diagnosticText(d)).not.toContain('{{');
                seen.add(d.code);
            }
        }
        expect(seen).toContain('expr.list-not-here');
        expect(seen).toContain('expr.function-not-here');
        expect(seen).toContain('expr.template-not-here');
        expect(seen).toContain('expr.record-not-here');

        // 差し込みの診断は行から出る（フロー行にも式にも属さない第三の入口）
        const lineDiagnostics: Diagnostic[] = [];
        splitInterpolations('- [ ] ${1 2} and ${unclosed', lineDiagnostics);
        for (const d of lineDiagnostics) {
            seen.add(d.code);
            expect(diagnosticText(d)).not.toContain('{{');
        }
        expect(seen).toContain('gen.trailing-input');
        expect(seen).toContain('gen.unterminated-interpolation');
    });

    // 段 2（js セクション）の診断は文パーサから出るので、式の網にも
    // フロー行の網にも載らない。ここで別に通す。
    describe('the js section', () => {
        const STATEMENT_SAMPLES = [
            'let x = 1 let y = 2',              // stmt.expected-end
            'let x = 1 +\n2',                   // stmt.unexpected-line-break
            '}',                                // stmt.unexpected-rbrace
            'const x',                          // stmt.const-needs-init
            'let [a, b]',                       // stmt.pattern-needs-init
            'let 1 = 2',                        // stmt.expected-binding
            'let {1: a} = xs',                  // stmt.expected-field-binding
            'let [a b] = xs',                   // stmt.expected-rbracket-pattern
            'let {a 1} = xs',                   // stmt.expected-rbrace-pattern
            'const f = x => { return x',        // stmt.expected-rbrace-fn
            'if (a) { b = 1',                   // stmt.expected-rbrace-body
            '{ let x = 1',                      // stmt.expected-rbrace-block
            'if a { b = 1 }',                   // stmt.expected-lparen
            'if (a { b = 1 }',                  // stmt.expected-rparen
            'for (const x of xs { y = 1 }',     // stmt.expected-rparen-head
            'for (const x in xs) { y = 1 }',    // stmt.expected-semicolon
            'for (let i = 0; i < n i += 1) { y = 1 }', // stmt.expected-second-semicolon
            'return 1',                         // stmt.return-not-here
            'if (a) b = 1',                     // stmt.body-needs-braces
            '{a: 1}',                           // stmt.record-needs-parens
            'var x = 1',                        // stmt.no-var
            'function f() { }',                 // stmt.no-function
            'class A { }',                      // stmt.no-class
            'try { x = 1 }',                    // stmt.no-try
            'throw 1',                          // stmt.no-throw
            'switch (x) { }',                   // stmt.no-switch
            'do { x = 1 } while (a)',           // stmt.no-do
            'async function f() { }',           // stmt.no-async
            'import x from "y"',                // stmt.no-import
            'export const x = 1',               // stmt.no-export
            'const d = new Date()',             // expr.no-new
            'let t = Date.now()',               // expr.no-date
            'console.log(1)',                   // expr.no-console
            'let f = function () { }',          // expr.no-function
            'let v = await x',                  // expr.no-await
            'let t = typeof x',                 // expr.no-typeof
            'delete x.y',                       // expr.no-delete
            'n++',                              // expr.increment-not-here
            '1 = 2',                            // expr.assign-target
            'xs.forEach(x => total += x)',      // expr.assign-needs-parens
            'let x = 1 /* c */',                // lex.no-block-comment
        ];

        // 検査は文パーサが通ったあとの層なので、サンプルを分けて持つ。
        const CHECK_SAMPLES = [
            'n = 1',                                 // stmt.assign-undeclared
            'const n = 1\nn = 2',                    // stmt.assign-to-const
            'let f = x => x\nf = 2',                 // stmt.assign-to-function
            'let n = 1\nn = "text"',                 // stmt.assign-type-change
            'let content = 1',                       // stmt.shadows-reserved
            'let n = 1\nlet n = 2',                  // stmt.already-declared
            'let ok = false\nif (ok = true) { }',    // stmt.assign-in-condition
            'break',                                 // stmt.break-not-in-loop
            'continue',                              // stmt.continue-not-in-loop
            'let [f] = [1]\nlet y = f(1)',           // type.not-callable
            'const f = a => a\nlet y = f(1, 2)',     // type.call-arity
            'const f = a => a\nlet y = f',           // expr.fn-not-a-value
            'let n = 1\nlet {b} = n',                // stmt.not-destructurable
            'for (const x of content) { }',          // stmt.not-iterable
        ];

        // ブロック構造の診断はブロックのパーサから出る。
        const BLOCK_SAMPLES: string[][] = [
            ['<js', 'let n = 1'],                                   // gen.js-section-unclosed
            ['<js', 'let n = 1', '/js>', '<js', 'let m = 2', '/js>'], // gen.js-section-duplicate
            ['- [ ] a', '<js', 'let n = 1', '/js>'],                // gen.js-section-after-body
        ];

        // 代入とコメントはブロックでは通る形なので、拒否はフロー行の側から出る。
        const FLOW_SAMPLES = [
            'every mon setContent(content = "x")', // expr.assign-not-here
            'every mon // weekly',                 // flow.comment-not-here
        ];

        const EXPECTED = [
            'stmt.expected-end', 'stmt.unexpected-line-break', 'stmt.unexpected-rbrace',
            'stmt.const-needs-init', 'stmt.pattern-needs-init', 'stmt.expected-binding',
            'stmt.expected-field-binding', 'stmt.expected-rbracket-pattern',
            'stmt.expected-rbrace-pattern', 'stmt.expected-rbrace-fn', 'stmt.expected-rbrace-body',
            'stmt.expected-rbrace-block', 'stmt.expected-lparen', 'stmt.expected-rparen',
            'stmt.expected-rparen-head', 'stmt.expected-semicolon', 'stmt.expected-second-semicolon',
            'stmt.return-not-here', 'stmt.body-needs-braces', 'stmt.record-needs-parens',
            'stmt.no-var', 'stmt.no-function', 'stmt.no-class', 'stmt.no-try', 'stmt.no-throw',
            'stmt.no-switch', 'stmt.no-do', 'stmt.no-async', 'stmt.no-import', 'stmt.no-export',
            'expr.no-new', 'expr.no-date', 'expr.no-console', 'expr.no-function', 'expr.no-await',
            'expr.no-typeof', 'expr.no-delete', 'expr.increment-not-here', 'expr.assign-target',
            'expr.assign-needs-parens', 'expr.fn-body-not-here', 'expr.assign-not-here',
            'lex.no-block-comment', 'flow.comment-not-here',
            'stmt.assign-undeclared', 'stmt.assign-to-const', 'stmt.assign-to-function',
            'stmt.assign-type-change', 'stmt.shadows-reserved', 'stmt.already-declared',
            'stmt.assign-in-condition', 'stmt.break-not-in-loop', 'stmt.continue-not-in-loop',
            'stmt.not-destructurable', 'stmt.not-iterable',
            'type.not-callable', 'type.call-arity', 'expr.fn-not-a-value',
            'gen.js-section-unclosed', 'gen.js-section-duplicate',
            'gen.js-section-after-body', 'expr.nesting-too-deep',
        ];

        function emitted(): Diagnostic[] {
            const all: Diagnostic[] = [];
            for (const src of STATEMENT_SAMPLES) all.push(...parseProgram(src).diagnostics);
            for (const src of FLOW_SAMPLES) all.push(...parseFlow(src).diagnostics);
            for (const src of CHECK_SAMPLES) {
                const { program } = parseProgram(src);
                checkProgram(program, FLOW_TYPE_ENV, all);
            }
            for (const lines of BLOCK_SAMPLES) all.push(...parseGenBody(lines, 1).diagnostics);
            // ホストのスタックが尽きる形は、書いて確かめるほうが早い。
            all.push(...parseFlow('at(' + '('.repeat(4000) + '1').diagnostics);
            // ブロックには文が無いので、{ } 本体の関数はブロック側からしか出ない。
            const { tokens, diagnostics } = tokenize('xs.map(x => { return x })');
            parseExpr(new TokenCursor(tokens), diagnostics, 'block');
            all.push(...diagnostics);
            return all;
        }

        it('emits every code the samples are here for', () => {
            const seen = new Set(emitted().map(d => d.code));
            for (const code of EXPECTED) expect(seen).toContain(code);
        });

        // 文言のフォールバックは英語なので、ロケールの欠落は表示では気づけない。
        // キーの実在を直に見る。日本語だけ落ちる形（1 code に複数のメッセージを
        // 持たせた結果、訳が 1 つしか置けない）もここで止まる。
        it('has a locale entry in every language for each of them', () => {
            for (const code of EXPECTED) {
                expect({ code, en: hasLocaleEntry(en, code) }).toEqual({ code, en: true });
                expect({ code, ja: hasLocaleEntry(ja, code) }).toEqual({ code, ja: true });
            }
        });

        it('renders each one with its params filled in', () => {
            for (const d of emitted()) {
                const text = diagnosticText(d);
                expect(text).not.toMatch(/^flowDiag\./);
                expect(text).not.toContain('{{');
            }
        });
    });

    it('falls back to the English default message for unknown codes', () => {
        const d: Diagnostic = {
            severity: 'error',
            code: 'flow.some-future-code',
            message: 'English fallback text',
            span: { start: 0, end: 1 },
        };
        expect(diagnosticText(d)).toBe('English fallback text');
    });
});
