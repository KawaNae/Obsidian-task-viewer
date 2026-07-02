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
            'repeat(weekly)',                   // flow.legacy-syntax
            'every mon at(today + 3d)',         // flow.duplicate-schedule
            'at(today + 1d) x5 x3',             // flow.duplicate-node
            'x5',                               // flow.orphan-modifier
            'every mon until 2026-02-30',       // flow.bad-date
            'at("text")',                       // type.at-not-datish
            'every mon set(due: "x")',          // type.set-date-mismatch
            'every mon set(content: start + due)', // type.cannot-combine
            'at(startOf("day"))',               // type.bad-unit-keyword
            'at(starrt)',                       // expr.unknown-ident
            'at(format(start))',                // type.arg-count
            '+3x',                              // lex.unknown-unit
        ];
        for (const src of samples) {
            for (const d of parseFlow(src).diagnostics) {
                const text = diagnosticText(d);
                // Never leak the raw key or unfilled placeholders
                expect(text).not.toMatch(/^flowDiag\./);
                expect(text).not.toContain('{{');
            }
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
