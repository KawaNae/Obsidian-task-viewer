import { describe, it, expect } from 'vitest';
import { parseFlow } from '../../../src/services/flow/FlowParser';
import { parseGenBody } from '../../../src/services/parsing/gen/GenBodyParser';

/**
 * The parser is recursive descent, so nesting is bounded by the host's call
 * stack rather than by any rule of this language. What comes back when it runs
 * out is a `RangeError`, and neither layer above can carry one: a generation
 * treats only `EvalError` as "did not fire", and the editor's diagnostics have
 * nowhere to put a crash. Both entry points turn it into a diagnostic.
 *
 * The counts here are far past anything a person or an LLM writes. They exist
 * to prove the failure has a shape, not to pin where the host gives up.
 */
describe('nesting past what the host stack holds', () => {
    const deepParens = '('.repeat(4000);
    const deep = `${deepParens}1${')'.repeat(4000)}`;

    it('comes back from a flow command as a diagnostic', () => {
        const { program, diagnostics } = parseFlow(`at(${deep})`);
        expect(program).toBeNull();
        expect(diagnostics.map(d => d.code)).toEqual(['expr.nesting-too-deep']);
    });

    it('comes back from a block as a diagnostic on its first line', () => {
        const body = parseGenBody([`- [ ] \${${deep}}`], 7);
        expect(body.diagnostics.map(d => [d.code, d.line])).toEqual([['expr.nesting-too-deep', 7]]);
        expect(body.parent).toBeNull();
    });

    it('comes back from a js section too', () => {
        const body = parseGenBody(['<js>', `let n = ${deep}`, '</js>'], 1);
        expect(body.diagnostics.map(d => d.code)).toEqual(['expr.nesting-too-deep']);
    });

    it('leaves an ordinary depth alone', () => {
        expect(parseFlow(`at(${'('.repeat(50)}today${')'.repeat(50)})`).diagnostics).toEqual([]);
    });
});
