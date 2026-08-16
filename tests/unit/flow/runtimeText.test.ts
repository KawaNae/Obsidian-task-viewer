import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setMockLocale } from '../mocks/obsidian';
import { initI18n } from '../../../src/i18n';
import ja from '../../../src/i18n/locales/ja.json';
import { error } from '../../../src/services/lang/Diagnostic';
import { EvalError } from '../../../src/services/lang/ExprEvaluator';
import { GenerationError } from '../../../src/services/flow/FlowPlanner';
import { runtimeText } from '../../../src/services/flow/runtimeText';

const SRC = fileURLToPath(new URL('../../../src/', import.meta.url));

/** Every `.ts` under src, since a throw can be added anywhere. */
function sourceFiles(): string[] {
    return readdirSync(SRC, { recursive: true, encoding: 'utf8' })
        .filter(name => name.endsWith('.ts'))
        .map(name => SRC + name);
}

/**
 * The first argument of every runtime-error construction, as it is written.
 *
 * Read off the source rather than from a list kept beside it: a list is a
 * second description of which codes exist, and the one thing it cannot catch
 * is the code nobody wrote down.
 */
const CONSTRUCTION = /new (?:EvalError|BudgetError|GenerationError|FnCallError)\(([^,)\n]*)[,)]/g;

/** A code carried out of an error being rethrown, rather than written here. */
const PROPAGATED = /^[A-Za-z_$][\w$]*(?:\.[\w$]+)*\.code$/;

const CONVENTION = [
    'A runtime error takes its code as the first argument, written as a literal',
    'on the same line as the constructor:',
    "    throw new EvalError('eval.prop-unset', `...`, span, { name })",
    'The only other accepted form is a code carried out of an error being',
    "rethrown, written as `<something>.code`. Everything else cannot be found",
    'by the scan that keeps the translations complete.',
].join('\n');

function thrownCodes(): string[] {
    const codes = new Set<string>();
    const offenders: string[] = [];
    for (const file of sourceFiles()) {
        const text = readFileSync(file, 'utf8');
        for (const [, arg] of text.matchAll(CONSTRUCTION)) {
            const written = arg.trim();
            const literal = /^'([^']*)'$/.exec(written);
            if (literal) codes.add(literal[1]);
            else if (!PROPAGATED.test(written)) {
                offenders.push(`${file.slice(SRC.length)}: ${written || '(nothing on this line)'}`);
            }
        }
    }
    expect(offenders, CONVENTION).toEqual([]);
    return [...codes];
}

/** Whether `flowEval.<family>.<name>` is spelled out in Japanese. */
function hasJapanese(code: string): boolean {
    const dot = code.indexOf('.');
    const family = (ja as { flowEval?: Record<string, Record<string, string>> })
        .flowEval?.[code.slice(0, dot)];
    return typeof family?.[code.slice(dot + 1)] === 'string';
}

/** Every `<family>.<name>` translated under one of the locale's roots. */
function codesUnder(root: 'flowEval' | 'flowDiag'): string[] {
    const tree = (ja as unknown as Record<string, Record<string, Record<string, string>>>)[root];
    return Object.entries(tree).flatMap(([family, names]) =>
        Object.keys(names).map(name => `${family}.${name}`));
}

function inJapanese(f: () => void): void {
    setMockLocale('ja');
    initI18n();
    try {
        f();
    } finally {
        setMockLocale('en');
        initI18n();
    }
}

describe('the sentences a failed fire can say', () => {
    it('has a Japanese translation for every code that is thrown', () => {
        const missing = thrownCodes()
            .filter(code => code.startsWith('eval.'))
            .filter(code => !hasJapanese(code))
            .sort();
        expect(missing).toEqual([]);
    });

    it('has nothing translated that is never thrown', () => {
        const thrown = new Set(thrownCodes());
        expect(codesUnder('flowEval').filter(code => !thrown.has(code)).sort()).toEqual([]);
    });

    it('keeps the two key spaces apart', () => {
        // `runtimeText` reads `flowEval` first and `flowDiag` second, which is
        // only safe while no code is spelled in both: a runtime translation
        // would win over the diagnostic one an error is carrying. The prefixes
        // keep them apart today, and this is what says so.
        const runtime = new Set(codesUnder('flowEval'));
        expect(codesUnder('flowDiag').filter(code => runtime.has(code)).sort()).toEqual([]);
    });

    it('says a failure in the reader language, and in English when it has no translation', () => {
        const known = new EvalError('eval.divide-by-zero', 'Division by zero', { start: 0, end: 1 });
        const future = new EvalError('eval.some-later-failure', 'English fallback text', { start: 0, end: 1 });
        inJapanese(() => {
            expect(runtimeText(known)).toBe('0 で割りました');
            expect(runtimeText(future)).toBe('English fallback text');
        });
        // Without a translation to reach, the English is what there is.
        expect(runtimeText(known)).toBe('Division by zero');
    });

    it('fills the values in', () => {
        const err = new EvalError('eval.prop-unset',
            `Property 'end' is not set on this task`, { start: 0, end: 1 }, { name: 'end' });
        inJapanese(() => {
            const text = runtimeText(err);
            expect(text).toContain("'end'");
            expect(text).not.toContain('{{');
        });
    });

    it('says both halves in one language when the sentence quotes a diagnostic', () => {
        // The block's own complaint is a diagnostic, and it has a translation of
        // its own. Carrying the text instead of the diagnostic would put an
        // English sentence inside a Japanese one.
        const inner = error('gen.missing-name',
            'A generation block needs a name — reference it with use("name")', { start: 0, end: 1 });
        const err = new GenerationError('eval.block-cannot-generate',
            `The block '週報' cannot generate: ${inner.message}`,
            { name: '週報', reason: inner.message }, inner);
        inJapanese(() => {
            const text = runtimeText(err);
            expect(text).toContain('週報');
            expect(text).toContain('生成ブロックには名前が必要です');
            expect(text).not.toContain('generation block needs');
        });
    });

    it('reads a diagnostic code where the diagnostics keep their translations', () => {
        // A generation refuses some lines by the rules the editor already
        // states, so the error carries that diagnostic's code as its own.
        const err = new GenerationError('gen.generated-command',
            'A generated line cannot carry a ==> command', undefined);
        inJapanese(() => {
            expect(runtimeText(err)).toContain('生成される行に ==> コマンドは書けません');
        });
    });
});
