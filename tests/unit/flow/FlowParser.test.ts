import { describe, it, expect } from 'vitest';
import { parseFlow } from '../../../src/services/flow/FlowParser';
import { serializeFlow } from '../../../src/services/flow/FlowSerializer';

function errors(raw: string): string[] {
    return parseFlow(raw).diagnostics.filter(d => d.severity === 'error').map(d => d.code);
}

describe('FlowParser', () => {
    describe('schedule clauses', () => {
        it('parses every with a single weekday', () => {
            const { program, diagnostics } = parseFlow('every mon');
            expect(diagnostics).toEqual([]);
            expect(program?.schedule).toMatchObject({ kind: 'every', rule: { type: 'weekdays', days: [1] } });
        });

        it('parses every with a weekday list', () => {
            const { program } = parseFlow('every tue,fri');
            expect(program?.schedule).toMatchObject({ rule: { type: 'weekdays', days: [2, 5] } });
        });

        it('parses every with an interval', () => {
            const { program } = parseFlow('every 2w');
            expect(program?.schedule).toMatchObject({ rule: { type: 'interval', amount: 2, unit: 'w' } });
        });

        it('parses every mo@N and mo@last', () => {
            expect(parseFlow('every mo@25').program?.schedule).toMatchObject({
                rule: { type: 'monthday', intervalMonths: 1, day: 25 },
            });
            expect(parseFlow('every mo@last').program?.schedule).toMatchObject({
                rule: { type: 'monthday', intervalMonths: 1, day: 'last' },
            });
            expect(parseFlow('every 2mo@15').program?.schedule).toMatchObject({
                rule: { type: 'monthday', intervalMonths: 2, day: 15 },
            });
        });

        it('parses completion-anchored +duration', () => {
            // Completion-relative offsets are expressions, not a clause head
            const { program, diagnostics } = parseFlow('at(today + 3d)');
            expect(diagnostics).toEqual([]);
            expect(program?.schedule?.kind).toBe('at');
        });

        it('rejects the removed +duration head', () => {
            expect(errors('+3d')).toContain('flow.unknown-head');
        });

        it('parses at(expr) escape hatch', () => {
            const { program, diagnostics } = parseFlow('at(startOf(month, done + 1mo) + 4d)');
            expect(diagnostics).toEqual([]);
            expect(program?.schedule?.kind).toBe('at');
        });

        it('parses grid() so every is expressible as an expression', () => {
            const { program, diagnostics } = parseFlow('at(grid(start, 3d))');
            expect(diagnostics).toEqual([]);
            expect(program?.schedule?.kind).toBe('at');
        });
    });

    describe('lifetime / options / move', () => {
        it('parses the full clause set order-free', () => {
            const canonical = parseFlow('every mon x14 until 2026-09-28 nochildren move([[Log/Done]])');
            const shuffled = parseFlow('nochildren until 2026-09-28 move([[Log/Done]]) x14 every mon');
            expect(canonical.diagnostics).toEqual([]);
            expect(shuffled.diagnostics).toEqual([]);
            expect(serializeFlow(shuffled.program!)).toBe(serializeFlow(canonical.program!));
        });

        it('parses telomere count', () => {
            expect(parseFlow('at(today + 1d) x14').program?.lifetime).toMatchObject({ count: 14 });
        });

        it('rejects x0', () => {
            expect(errors('at(today + 1d) x0')).toContain('flow.zero-lifetime');
        });

        it('parses set with multiple typed assignments', () => {
            const { program, diagnostics } = parseFlow('every mon set(content: "週報 " + format(start, "MM/DD"), due: start + 3d)');
            expect(diagnostics).toEqual([]);
            expect(program?.set?.assignments.map(a => a.field)).toEqual(['content', 'due']);
        });

        it('parses move alone (no schedule)', () => {
            const { program, diagnostics } = parseFlow('move([[Archive]])');
            expect(diagnostics).toEqual([]);
            expect(program?.schedule).toBeUndefined();
            expect(program?.move).toBeDefined();
        });
    });

    describe('diagnostics', () => {
        it('rejects misordered heads like "tue every"', () => {
            expect(errors('tue every')).toContain('flow.unknown-head');
        });

        it('rejects duplicate schedule clauses', () => {
            expect(errors('every mon at(today + 3d)')).toContain('flow.duplicate-schedule');
        });

        it('rejects duplicate lifetimes', () => {
            expect(errors('at(today + 1d) x5 x3')).toContain('flow.duplicate-node');
        });

        it('rejects orphan modifiers without a schedule', () => {
            expect(errors('x5')).toContain('flow.orphan-modifier');
            expect(errors('nochildren')).toContain('flow.orphan-modifier');
            expect(errors('until 2026-09-28')).toContain('flow.orphan-modifier');
        });

        it('reports legacy syntax with a dedicated code', () => {
            expect(errors('repeat(weekly)')).toContain('flow.legacy-syntax');
            expect(errors('next(monday).as(text)')).toContain('flow.legacy-syntax');
        });

        it('rejects invalid calendar dates in until', () => {
            expect(errors('every mon until 2026-02-30')).toContain('flow.bad-date');
        });

        it('rejects bad set field types', () => {
            expect(errors('every mon set(due: "text")')).toContain('type.set-date-mismatch');
            expect(errors('every mon set(content: 3d)')).toContain('type.set-content-not-string');
        });

        it('rejects non-datish at()', () => {
            expect(errors('at("text")')).toContain('type.at-not-datish');
        });

        it('returns null program with raw preserved semantics on prose', () => {
            const { program, diagnostics } = parseFlow('see https://example.com for details');
            expect(program).toBeNull();
            expect(diagnostics.length).toBeGreaterThan(0);
        });

        it('program is null iff there are error diagnostics', () => {
            for (const src of ['every mon', 'garbage', 'every mon x0', 'move([[A]])']) {
                const { program, diagnostics } = parseFlow(src);
                const hasError = diagnostics.some(d => d.severity === 'error');
                expect(program === null).toBe(hasError);
            }
        });
    });

    describe('round-trip', () => {
        it.each([
            'every mon',
            'every tue,fri',
            'every 2w',
            'every mo@25',
            'every mo@last',
            'every 2mo@15',
            'at(today + 3d)',
            'at(done + 30min)',
            'at(grid(start, 3d))',
            'every mon x14',
            'every mon until 2026-09-28',
            'every mon x14 until 2026-09-28 nochildren',
            'move([[Archive/Done]])',
            'every mon move([[Log]])',
            'at(startOf(month, done + 1mo) + 4d)',
            'every mon set(content: "週報 " + format(start, "MM/DD"), due: start + 3d)',
        ])('parse → serialize → parse is stable: %s', (src) => {
            const first = parseFlow(src);
            expect(first.program).not.toBeNull();
            const printed = serializeFlow(first.program!);
            const second = parseFlow(printed);
            expect(second.diagnostics).toEqual([]);
            expect(serializeFlow(second.program!)).toBe(printed);
        });

        it('normalizes clause order canonically', () => {
            const { program } = parseFlow('move([[A]]) until 2026-09-28 every mon x3');
            expect(serializeFlow(program!)).toBe('every mon x3 until 2026-09-28 move([[A]])');
        });
    });
});
