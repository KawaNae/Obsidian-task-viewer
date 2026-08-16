import { describe, it, expect } from 'vitest';
import { parseProgram } from '../../../src/services/lang/StmtParser';
import { parseFlow } from '../../../src/services/flow/FlowParser';
import { parseGenBody } from '../../../src/services/parsing/gen/GenBodyParser';
import type { Diagnostic } from '../../../src/services/lang/Diagnostic';

/**
 * Names every object inherits, read as ordinary words.
 *
 * The readers of this language look words up in tables written as object
 * literals, and a literal answers for the twelve names below whether or not it
 * declares them. Sweeping the list through every entrance is what found that:
 * `x.toString()` threw out of the parser, `every mon toString(1)` was accepted
 * and then dropped by the printer, and `${constructor}` produced a diagnostic
 * with no code. The same sweep is what keeps them shut.
 *
 * The assertion is a comparison, not a list of expected codes: a word this
 * language does not know has to be treated exactly like any other word it does
 * not know. Written that way, a reader added later is covered by the same
 * test as long as the control goes through it.
 */
const INHERITED = Object.getOwnPropertyNames(Object.prototype);

/** A word no table has, and no table ever will. */
const CONTROL = 'zzzUnknownWord';

const codes = (diagnostics: Diagnostic[]) => diagnostics.map(d => d.code);

/** Every diagnostic can be translated and read. Undefined is neither. */
function assertSpeaks(diagnostics: Diagnostic[], where: string): void {
    for (const d of diagnostics) {
        expect(d.code, `${where}: a diagnostic with no code cannot be translated`).toBeTypeOf('string');
        expect(d.message, `${where}: a diagnostic with no message says nothing`).toBeTypeOf('string');
    }
}

describe('a name every object inherits is still just a name', () => {
    it('at the head of a statement', () => {
        const control = parseProgram(CONTROL);
        for (const name of INHERITED) {
            const got = parseProgram(name);
            assertSpeaks(got.diagnostics, `statement '${name}'`);
            expect(codes(got.diagnostics), `statement '${name}'`).toEqual(codes(control.diagnostics));
            expect(got.program.body.map(s => s.kind), `statement '${name}'`)
                .toEqual(control.program.body.map(s => s.kind));
        }
    });

    it('at the head of a flow clause', () => {
        const control = parseFlow(`every mon ${CONTROL}(1)`);
        expect(control.program, 'the control has to be refused, or this proves nothing').toBeNull();
        for (const name of INHERITED) {
            const got = parseFlow(`every mon ${name}(1)`);
            assertSpeaks(got.diagnostics, `clause '${name}'`);
            expect(codes(got.diagnostics), `clause '${name}'`).toEqual(codes(control.diagnostics));
            expect(got.program, `clause '${name}'`).toBeNull();
        }
    });

    it('as a bare identifier in a body line', () => {
        const control = parseGenBody([`- [ ] c \${${CONTROL}}`], 0);
        expect(codes(control.diagnostics)).toEqual(['expr.unknown-ident']);
        for (const name of INHERITED) {
            const got = parseGenBody([`- [ ] c \${${name}}`], 0);
            assertSpeaks(got.diagnostics, `identifier '${name}'`);
            expect(codes(got.diagnostics), `identifier '${name}'`).toEqual(codes(control.diagnostics));
        }
    });

    it('as a member read', () => {
        const control = parseGenBody([`- [ ] c \${"a".${CONTROL}}`], 0);
        expect(codes(control.diagnostics)).toEqual(['type.unknown-member']);
        for (const name of INHERITED) {
            const got = parseGenBody([`- [ ] c \${"a".${name}}`], 0);
            assertSpeaks(got.diagnostics, `member '${name}'`);
            expect(codes(got.diagnostics), `member '${name}'`).toEqual(codes(control.diagnostics));
        }
    });

    it('as a method call, on a scalar and on a list', () => {
        // Two receivers because the signatures live in two tables: the scalar
        // members are one lookup, a list's methods another.
        for (const receiver of ['"a"', '[1]', '(2)']) {
            const control = parseGenBody([`- [ ] c \${${receiver}.${CONTROL}()}`], 0);
            expect(codes(control.diagnostics), `control on ${receiver}`).toEqual(['type.unknown-member']);
            for (const name of INHERITED) {
                const got = parseGenBody([`- [ ] c \${${receiver}.${name}()}`], 0);
                assertSpeaks(got.diagnostics, `method '${receiver}.${name}()'`);
                expect(codes(got.diagnostics), `method '${receiver}.${name}()'`)
                    .toEqual(codes(control.diagnostics));
            }
        }
    });

    it('inside a js section, where a statement and an expression meet', () => {
        const control = parseGenBody(['<js', `const s = "a".${CONTROL}();`, '/js>', '- [ ] c ${s}'], 0);
        for (const name of INHERITED) {
            const got = parseGenBody(['<js', `const s = "a".${name}();`, '/js>', '- [ ] c ${s}'], 0);
            assertSpeaks(got.diagnostics, `section '${name}'`);
            expect(codes(got.diagnostics), `section '${name}'`).toEqual(codes(control.diagnostics));
        }
    });
});
