import { describe, it, expect } from 'vitest';
import { isCellType } from '../../../src/services/lang/ExprChecker';
import { arrayOf, recordOf, type StaticType } from '../../../src/services/lang/functions';
import type { Value } from '../../../src/services/lang/Value';
import { isCellValue } from '../../../src/services/flow/FlowAst';

/**
 * `isCellType` (checked against a `StaticType`, while a block is being
 * written) and `isCellValue` (checked against a `Value`, after the block has
 * run) are two independent readings of one rule — a cell may hold anything
 * except a list, a record, or nothing. Both files say in comments that they
 * must move together; nothing else enforces it. This is that enforcement:
 * one representative (type, value) pair per `Value` tag, asserted against
 * both predicates and against the rule's own definition, so a future value
 * kind that updates one exclusion list and not the other fails here instead
 * of silently letting an unprintable value through cell write-back.
 */
const CASES: { tag: string; type: StaticType; value: Value; storable: boolean }[] = [
    { tag: 'date', type: 'date', value: { type: 'date', value: '2026-01-01' }, storable: true },
    { tag: 'datetime', type: 'datetime', value: { type: 'datetime', date: '2026-01-01', time: '09:00' }, storable: true },
    { tag: 'time', type: 'time', value: { type: 'time', value: '09:00' }, storable: true },
    { tag: 'duration', type: 'duration', value: { type: 'duration', amount: 1, unit: 'd' }, storable: true },
    { tag: 'string', type: 'string', value: { type: 'string', value: 'x' }, storable: true },
    { tag: 'number', type: 'number', value: { type: 'number', value: 1 }, storable: true },
    { tag: 'bool', type: 'bool', value: { type: 'bool', value: true }, storable: true },
    { tag: 'link', type: 'link', value: { type: 'link', target: 'note.md' }, storable: true },
    { tag: 'array', type: arrayOf('string'), value: { type: 'array', items: [] }, storable: false },
    { tag: 'record', type: recordOf({ a: 'string' }), value: { type: 'record', entries: [] }, storable: false },
    { tag: 'none', type: 'none', value: { type: 'none' }, storable: false },
];

/**
 * Compile-time exhaustiveness guard: forces every `Value` tag through the
 * switch below. Adding a new `Value` variant without adding a case here is a
 * `tsc` error (caught by `npm run build`, not just this test file), which is
 * what actually keeps `CASES` complete — the runtime assertion in the test
 * below is a second, weaker check for when this file is read on its own.
 */
function assertHandledByCases(value: Value): void {
    switch (value.type) {
        case 'date': case 'datetime': case 'time': case 'duration':
        case 'string': case 'number': case 'bool': case 'link':
        case 'array': case 'record': case 'none':
            return;
        default: {
            const _exhaustive: never = value;
            void _exhaustive;
        }
    }
}

describe('cell storability: isCellType and isCellValue agree', () => {
    for (const { tag, type, value, storable } of CASES) {
        it(`${tag}: both predicates say storable=${storable}`, () => {
            assertHandledByCases(value);
            expect(isCellType(type)).toBe(storable);
            expect(isCellValue(value)).toBe(storable);
        });
    }

    it('covers every Value tag exactly once', () => {
        expect(CASES.map(c => c.tag).sort()).toEqual(
            ['array', 'bool', 'date', 'datetime', 'duration', 'link', 'none', 'number', 'record', 'string', 'time'],
        );
    });
});
