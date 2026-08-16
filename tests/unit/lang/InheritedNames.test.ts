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
 * with no code.
 *
 * Two rules keep it shut, and they are the whole of what this file is for.
 * Every entrance that takes a word out of a file belongs in the sweep. And the
 * sweep is written as a comparison against control words rather than as a list
 * of expected codes, so a reader added later is covered the moment its
 * entrance is added — no ledger of what is safe has to be maintained by hand.
 */
const INHERITED = Object.getOwnPropertyNames(Object.prototype);

/**
 * Words no table has, and no table ever will.
 *
 * Two of them, differing in the characters and not in what they mean: half the
 * inherited names begin with an underscore, and an entrance that is sensitive
 * to that would otherwise show up as a difference here and read as pollution.
 * The controls have to agree with each other before either can stand in for
 * "a word this language does not know".
 */
const CONTROLS = ['zzzUnknownWord', '__zzzUnknownWord__'];

const codes = (diagnostics: Diagnostic[]) => diagnostics.map(d => d.code ?? '(no code)');

/** Every diagnostic can be translated and read. Undefined is neither. */
function speaks(diagnostics: Diagnostic[]): string[] {
    return diagnostics.flatMap(d => [
        typeof d.code === 'string' ? [] : ['a diagnostic with no code cannot be translated'],
        typeof d.message === 'string' ? [] : ['a diagnostic with no message says nothing'],
    ].flat());
}

/**
 * Run one entrance over the controls and every inherited name.
 *
 * `read` answers with whatever the entrance produced, written as strings: the
 * diagnostic codes, and whatever else that entrance decides (a refusal, the
 * shape of what it parsed).
 */
function sweep(where: string, read: (word: string) => string[]): void {
    const [first, ...rest] = CONTROLS.map(read);
    for (let i = 0; i < rest.length; i++) {
        expect(rest[i], `${where}: the controls disagree, so neither can stand for an unknown word`)
            .toEqual(first);
    }
    for (const name of INHERITED) {
        expect(read(name), `${where}: '${name}' is read differently from a word this language does not know`)
            .toEqual(first);
    }
}

describe('a name every object inherits is still just a name', () => {
    it('at the head of a statement', () => {
        sweep('statement head', word => {
            const { program, diagnostics } = parseProgram(word);
            return [...speaks(diagnostics), ...codes(diagnostics), ...program.body.map(s => `stmt:${s.kind}`)];
        });
    });

    it('at the head of a flow clause', () => {
        sweep('flow head', word => {
            const { program, diagnostics } = parseFlow(`every mon ${word}(1)`);
            return [...speaks(diagnostics), ...codes(diagnostics), program === null ? 'refused' : 'accepted'];
        });
        // The control has to be refused, or the comparison proves nothing.
        expect(parseFlow(`every mon ${CONTROLS[0]}(1)`).program).toBeNull();
    });

    it('as a bare identifier in a body line', () => {
        sweep('bare identifier', word => {
            const body = parseGenBody([`- [ ] c \${${word}}`], 0);
            return [...speaks(body.diagnostics), ...codes(body.diagnostics)];
        });
        expect(codes(parseGenBody([`- [ ] c \${${CONTROLS[0]}}`], 0).diagnostics)).toEqual(['expr.unknown-ident']);
    });

    it('as a member read', () => {
        sweep('member read', word => {
            const body = parseGenBody([`- [ ] c \${"a".${word}}`], 0);
            return [...speaks(body.diagnostics), ...codes(body.diagnostics)];
        });
        expect(codes(parseGenBody([`- [ ] c \${"a".${CONTROLS[0]}}`], 0).diagnostics)).toEqual(['type.unknown-member']);
    });

    it('as a method call, on a scalar and on a list', () => {
        // Three receivers because the signatures live in three tables: the
        // string members, the number methods, and a list's own.
        for (const receiver of ['"a"', '(2)', '[1]']) {
            sweep(`method on ${receiver}`, word => {
                const body = parseGenBody([`- [ ] c \${${receiver}.${word}()}`], 0);
                return [...speaks(body.diagnostics), ...codes(body.diagnostics)];
            });
            expect(codes(parseGenBody([`- [ ] c \${${receiver}.${CONTROLS[0]}()}`], 0).diagnostics))
                .toEqual(['type.unknown-member']);
        }
    });

    it('inside a flow clause, which the scanner reads on every file', () => {
        // Not the head this time but the expression a clause holds. A block is
        // only read where a block is written; a command is read by the scan of
        // every file, so the same lookup sits on a much wider path.
        sweep('flow argument', word => {
            const { diagnostics } = parseFlow(`until(start.${word}())`);
            return [...speaks(diagnostics), ...codes(diagnostics)];
        });
        expect(codes(parseFlow(`until(start.${CONTROLS[0]}())`).diagnostics)).toContain('type.unknown-member');
    });

    it('inside a js section, where a statement and an expression meet', () => {
        sweep('js section', word => {
            const body = parseGenBody(['<js>', `const s = "a".${word}();`, '</js>', '- [ ] c ${s}'], 0);
            return [...speaks(body.diagnostics), ...codes(body.diagnostics)];
        });
    });
});
