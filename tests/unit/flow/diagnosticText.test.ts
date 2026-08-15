import { describe, it, expect } from 'vitest';
import { diagnosticText } from '../../../src/services/flow/diagnosticText';
import { parseFlow } from '../../../src/services/flow/FlowParser';
import { Diagnostic } from '../../../src/services/lang/Diagnostic';
import { FLOW_TYPE_ENV, checkExpr } from '../../../src/services/lang/ExprChecker';
import { parseExpr, splitInterpolations } from '../../../src/services/lang/ExprParser';
import { tokenize } from '../../../src/services/lang/Lexer';
import { TokenCursor } from '../../../src/services/lang/Token';

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
            'at(today + 0.5d)',                 // lex.decimal-unsupported
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
            'type.member-arg', 'lex.decimal-unsupported', 'expr.nullish-mixed-with-logic', 'expr.comparison-chain']) {
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
