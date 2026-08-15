import { describe, it, expect } from 'vitest';
import { diagnosticText } from '../../../src/services/flow/diagnosticText';
import { parseFlow } from '../../../src/services/flow/FlowParser';
import { Diagnostic } from '../../../src/services/lang/Diagnostic';

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
        for (const code of ['expr.weekday-not-literal', 'type.bad-weekday-name',
            'type.nullish-mismatch', 'type.member-arity', 'type.unknown-member',
            'type.member-arg', 'lex.decimal-unsupported', 'expr.nullish-mixed-with-logic']) {
            expect(seen).toContain(code);
        }
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
