import { describe, it, expect } from 'vitest';
import { API_HELP_TEXT } from '../../../src/api/TaskApi';
import { HELP_TEXT } from '../../../src/cli/handlers/HelpHandler';
import { PROPERTY_OPERATORS } from '../../../src/services/filter/FilterTypes';

/**
 * `OperationSchemas.ts`'s own doc comment says the "Properties & Operators"
 * prose in both API_HELP_TEXT and HELP_TEXT is deliberately hand-written, not
 * generated — but nothing enforced that the two stayed in sync with each
 * other, or with `PROPERTY_OPERATORS` (the actual single source of truth the
 * filter engine reads). This is the "lint-able cross-check" the audit (F06)
 * suggested as the lower-cost alternative to generating the block: extract
 * each help text's `property: op1, op2, ...` lines and assert the operator
 * set for every property matches `PROPERTY_OPERATORS` exactly.
 *
 * (Found while writing this: `PROPERTY_OPERATORS.tag` already had a 4th
 * operator, `only`, that neither help text documented — fixed alongside this
 * test.)
 */

function section(text: string, startMarker: string, endMarker: string): string {
    const start = text.indexOf(startMarker);
    if (start < 0) throw new Error(`start marker not found: ${startMarker}`);
    const from = start + startMarker.length;
    const end = text.indexOf(endMarker, from);
    if (end < 0) throw new Error(`end marker not found: ${endMarker}`);
    return text.slice(from, end);
}

/**
 * `property: op1, op2 (aside), ...` lines, one property per line (a wrapped
 * value-type continuation line has no `word:` prefix and is skipped). Parens
 * asides (e.g. "(hierarchy)", "(exact)") are stripped before splitting on
 * commas. A line whose entire rest is `(same as OTHER)` resolves to OTHER's
 * operator list.
 */
function parsePropertyOperators(sectionText: string): Record<string, string[]> {
    const raw: Record<string, string> = {};
    for (const line of sectionText.split('\n')) {
        const m = /^\s*([A-Za-z]+)\s*:\s*(.+)$/.exec(line);
        if (!m) continue;
        raw[m[1]] = m[2];
    }
    const result: Record<string, string[]> = {};
    for (const [prop, rest] of Object.entries(raw)) {
        const sameAs = /^\(same as (\w+)\)$/i.exec(rest.trim());
        const source = sameAs ? raw[sameAs[1]] : rest;
        result[prop] = source.replace(/\([^)]*\)/g, '').split(',').map(s => s.trim()).filter(Boolean);
    }
    return result;
}

const apiSection = section(API_HELP_TEXT, 'Properties & Operators:', 'NormalizedTask Fields');
const cliSection = section(HELP_TEXT, 'Properties & Operators\n', 'Value Types');

const apiOperators = parsePropertyOperators(apiSection);
const cliOperators = parsePropertyOperators(cliSection);

describe('help text operator tables stay in sync with PROPERTY_OPERATORS', () => {
    const properties = Object.keys(PROPERTY_OPERATORS) as (keyof typeof PROPERTY_OPERATORS)[];

    it('both help texts document every property PROPERTY_OPERATORS declares', () => {
        for (const prop of properties) {
            expect(apiOperators, `TaskApi.API_HELP_TEXT missing property '${prop}'`).toHaveProperty(prop);
            expect(cliOperators, `HelpHandler.HELP_TEXT missing property '${prop}'`).toHaveProperty(prop);
        }
    });

    for (const prop of properties) {
        it(`${prop}: TaskApi help text lists the same operators as PROPERTY_OPERATORS`, () => {
            expect(new Set(apiOperators[prop])).toEqual(new Set(PROPERTY_OPERATORS[prop]));
        });

        it(`${prop}: CLI help text lists the same operators as PROPERTY_OPERATORS`, () => {
            expect(new Set(cliOperators[prop])).toEqual(new Set(PROPERTY_OPERATORS[prop]));
        });
    }
});
