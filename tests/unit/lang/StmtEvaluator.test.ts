import { describe, it, expect } from 'vitest';
import { type EvalContext, EvalError, evalExpr } from '../../../src/services/lang/ExprEvaluator';
import { parseExpr } from '../../../src/services/lang/ExprParser';
import { tokenize } from '../../../src/services/lang/Lexer';
import { execProgram } from '../../../src/services/lang/StmtEvaluator';
import { parseProgram } from '../../../src/services/lang/StmtParser';
import { TokenCursor } from '../../../src/services/lang/Token';
import { valueToDisplay } from '../../../src/services/lang/Value';

const host = { formatDate: (_v: unknown, tokens: string) => `[${tokens}]` };

function context(fuel = 100_000): EvalContext {
    return {
        props: {
            content: { type: 'string', value: 'task' },
            today: { type: 'date', value: '2026-08-16' },
        },
        today: '2026-08-16',
        now: { date: '2026-08-16', time: '09:00' },
        weekStartDay: 1,
        host: host as never,
        fuel: { left: fuel, depth: 0 },
    };
}

/** Run a section, then read one expression against the scope it left. */
function run(section: string, read: string, fuel?: number): string {
    const { program, diagnostics } = parseProgram(section);
    expect(diagnostics).toEqual([]);
    const ctx = context(fuel);
    const scope = execProgram(program, ctx);
    const { tokens, diagnostics: readDiagnostics } = tokenize(read);
    const expr = parseExpr(new TokenCursor(tokens), readDiagnostics, 'stmt');
    expect(readDiagnostics).toEqual([]);
    return valueToDisplay(evalExpr(expr!, { ...ctx, scope }));
}

/** The message of the failure a section produces, or '' when it finishes. */
function fails(section: string, read = 'true', fuel?: number): string {
    try {
        run(section, read, fuel);
        return '';
    } catch (e) {
        if (e instanceof EvalError) return e.message;
        throw e;
    }
}

describe('StmtEvaluator', () => {
    describe('bindings', () => {
        it('declares and reads back', () => {
            expect(run('let n = 1', 'n')).toBe('1');
            expect(run('const s = "a" + "b"', 's')).toBe('ab');
        });

        it('yields the written value from an assignment, which is the counter shape', () => {
            expect(run('let n = 1', 'n += 1')).toBe('2');
            expect(run('let n = 1\nn = n + 1', 'n')).toBe('2');
        });

        it('writes to the frame that declared the name', () => {
            expect(run('let n = 1\n{ n = 2 }', 'n')).toBe('2');
        });

        it('keeps an inner declaration inside its block', () => {
            expect(run('let n = 1\n{ let n = 2 }', 'n')).toBe('1');
        });

        it('refuses a write with no declaration behind it', () => {
            // 検査が先に止めるが、実行器も自前で断る。JS の暗黙グローバルを
            // 作らないという規則を、どちらか片方に預けない。
            expect(fails('n = 1')).toContain("'n' was never declared");
            expect(fails('const n = 1\nn = 2')).toContain('const');
        });
    });

    describe('control flow', () => {
        it('runs a while to its end', () => {
            expect(run('let n = 5\nlet m = 0\nwhile (n > 0) { n = n - 1\nm = m + 1 }', 'm')).toBe('5');
        });

        it('runs a classic for', () => {
            expect(run('let s = ""\nfor (let i = 0; i < 3; i += 1) { s = s + i.toFixed(0) }', 's')).toBe('012');
        });

        it('walks a list with for-of', () => {
            expect(run('let s = ""\nfor (const x of ["a", "b"]) { s = s + x }', 's')).toBe('ab');
        });

        it('takes break and continue', () => {
            const body = 'let s = ""\nfor (const x of ["a", "b", "c"]) { if (x == "b") { KEYWORD }\ns = s + x }';
            expect(run(body.replace('KEYWORD', 'continue'), 's')).toBe('ac');
            expect(run(body.replace('KEYWORD', 'break'), 's')).toBe('a');
        });

        it('gives a for-of turn its own frame, so a closure keeps that element', () => {
            expect(run(
                'let out = []\nfor (const x of [1, 2]) { out = out.concat([x * 10]) }',
                'out.join(",")')).toBe('10,20');
        });
    });

    describe('functions', () => {
        it('calls an expression body and a block body alike', () => {
            expect(run('const f = x => x * 2', 'f(21)')).toBe('42');
            expect(run('const f = x => { let y = x * 2\nreturn y }', 'f(21)')).toBe('42');
        });

        it('answers with the missing value when a body falls off the end', () => {
            expect(run('const f = x => { return }', 'f(1)')).toBe('');
        });

        it('returns from inside a branch', () => {
            expect(run(
                'const f = x => { if (x > 0) { return "pos" }\nreturn "neg" }',
                'f(1) + f(-1)')).toBe('posneg');
        });

        it('closes over where it was written, and sees later writes there', () => {
            expect(run('const k = 10\nconst f = x => x + k', 'f(5)')).toBe('15');
            expect(run('let n = 1\nconst f = () => n\nn = 2', 'f()')).toBe('2');
        });

        it('takes a block body as a list method callback', () => {
            expect(run('let xs = [1, 2, 3]', 'xs.map(x => { return x * 2 }).join("-")')).toBe('2-4-6');
        });

        it('lets a callback write a local of the section', () => {
            expect(run('let total = 0\n[1, 2, 3].forEach(x => { total = total + x })', 'total')).toBe('6');
        });
    });

    describe('what stops a block that will not stop on its own', () => {
        it('spends fuel and gives up', () => {
            expect(fails('let n = 0\nwhile (true) { n = n + 1 }'))
                .toContain('ran past what one generation is allowed to compute');
        });

        // 式を持たない本体でもループの 1 周ごとに 1 消費する。そうしないと
        // for (;;) {} が燃料を減らさずに回り続ける。
        it('spends it on an empty loop body too', () => {
            expect(fails('for (;;) { }', 'true', 500)).toContain('ran past');
        });

        // 燃料だけでは足りない。ホストのスタックが先に尽きて RangeError になり、
        // 「発火しない」として報告できない失敗になる。
        it('stops a function calling itself before the host stack does', () => {
            expect(fails('const f = x => f(x)', 'f(1)')).toContain('calls deep');
        });

        // 天井は入口ではなくここに置いてある。プレビューや段 3 で 2 つ目の
        // 入口ができても、そこで抜けない。
        it('makes its own budget when the caller brought none', () => {
            const { program } = parseProgram('let n = 0\nwhile (true) { n = n + 1 }');
            const bare: EvalContext = { ...context(), fuel: undefined };
            expect(() => execProgram(program, bare)).toThrow(/ran past/);
        });

        it('leaves a flow clause unmetered', () => {
            // fuel の無い文脈では burn は何もしない。フロー節は式ひとつで、
            // ループも自作関数の呼び出しも書けない。
            const { tokens, diagnostics } = tokenize('1 + 1');
            const expr = parseExpr(new TokenCursor(tokens), diagnostics, 'flow');
            const bare: EvalContext = { ...context(), fuel: undefined };
            expect(valueToDisplay(evalExpr(expr!, bare))).toBe('2');
        });
    });
});
