import { describe, it, expect } from 'vitest';
import { parseFlow } from '../../../src/services/flow/FlowParser';
import { serializeFlow } from '../../../src/services/flow/FlowSerializer';

describe('gen v3 sample 5 (date arithmetic)', () => {
    it('parses the expressions the sample uses', () => {
        const srcs = [
            'every 1mo use("締め")',
            'at(tv.date.endOf("month", start))',
            'at(tv.date.startOf("month", start) + 5d)',
            'at(start - 3d)',
            'every mon setContent(start.format("YYYY-MM-DD"))',
        ];
        for (const src of srcs) {
            const { program, diagnostics } = parseFlow(src);
            expect(diagnostics.filter(d => d.severity === 'error')).toEqual([]);
            expect(program).not.toBeNull();
            const printed = serializeFlow(program!);
            const again = parseFlow(printed);
            expect(again.diagnostics).toEqual([]);
            expect(serializeFlow(again.program!)).toBe(printed);
        }
    });
});
