import { describe, it, expect } from 'vitest';
import type { Diagnostic } from '../../../src/services/lang/Diagnostic';
import { FLOW_TYPE_ENV } from '../../../src/services/lang/ExprChecker';
import { checkProgram } from '../../../src/services/lang/StmtChecker';
import { parseProgram } from '../../../src/services/lang/StmtParser';

/** Check a section that parses cleanly — a parse error here is a broken test. */
function check(src: string): Diagnostic[] {
    const { program, diagnostics } = parseProgram(src);
    expect(diagnostics).toEqual([]);
    const found: Diagnostic[] = [];
    checkProgram(program, FLOW_TYPE_ENV, found);
    return found;
}

function codes(src: string): string[] {
    return check(src).map(d => d.code);
}

/** What the body's interpolations can read after the section has run. */
function exported(src: string): string[] {
    const { program } = parseProgram(src);
    const bindings = checkProgram(program, FLOW_TYPE_ENV, []);
    return [...bindings.vars.keys(), ...bindings.fns.keys()].sort();
}

describe('StmtChecker', () => {
    describe('what a name means', () => {
        it('accepts a declaration and the writes that follow it', () => {
            expect(codes('let n = 1\nn = 2\nn += 3')).toEqual([]);
        });

        // 暗黙のグローバルは作らない。宣言の無い名前は打ち間違いであって、
        // 新しい束縛ではない。
        it('refuses a write to a name nothing declared', () => {
            expect(codes('n = 1')).toEqual(['stmt.assign-undeclared']);
            expect(codes('let n = 1\n{ let m = 2 }\nm = 3')).toEqual(['stmt.assign-undeclared']);
        });

        it('refuses a write to a const', () => {
            expect(codes('const n = 1\nn = 2')).toEqual(['stmt.assign-to-const']);
        });

        it('refuses a second declaration of the same name in one scope', () => {
            expect(codes('let n = 1\nlet n = 2')).toEqual(['stmt.already-declared']);
            expect(codes('let n = 1\n{ let n = 2 }')).toEqual([]);
        });

        it('reports an unknown name where it is read', () => {
            expect(codes('let y = nope')).toEqual(['expr.unknown-ident']);
        });

        // R6b: 解決は束縛より先に効くので、隠した名前は参照できない。
        it('warns when a declaration shadows a name the parser resolves first', () => {
            for (const name of ['content', 'today', 'Math', 'undefined', 'null', 'none']) {
                const found = check(`let ${name} = 1`);
                expect({ name, codes: found.map(d => d.code) })
                    .toEqual({ name, codes: ['stmt.shadows-reserved'] });
                expect(found[0].severity).toBe('warning');
            }
        });

        it('holds the unknown for a let with nothing to go on', () => {
            // `let x` then writing it on the next line is an ordinary shape;
            // typing it as the missing value would refuse every write.
            expect(codes('let x\nx = 5\nx = "text"')).toEqual([]);
        });

        it('warns, but does not refuse, when a binding changes what it holds', () => {
            const found = check('let n = 1\nn = "text"');
            expect(found.map(d => [d.code, d.severity])).toEqual([['stmt.assign-type-change', 'warning']]);
        });
    });

    describe('scope', () => {
        it('lets an inner block see out, and keeps its own declarations in', () => {
            expect(codes('let n = 1\n{ let m = n }\nlet k = 2')).toEqual([]);
            expect(codes('{ let m = 1 }\nlet k = m')).toEqual(['expr.unknown-ident']);
        });

        it('scopes a for head to its loop', () => {
            expect(codes('for (let i = 0; i < 3; i += 1) { let x = i }')).toEqual([]);
            expect(codes('for (let i = 0; i < 3; i += 1) { }\nlet y = i')).toEqual(['expr.unknown-ident']);
        });

        it('binds a for-of target to one element of the list', () => {
            expect(codes('for (const s of ["a"]) { let n = s.length }')).toEqual([]);
            expect(codes('for (const s of ["a"]) { let n = s.nope }')).toEqual(['type.unknown-member']);
        });

        it('says so when the thing being walked is not a list', () => {
            expect(codes('for (const x of content) { }')).toEqual(['stmt.not-iterable']);
        });

        it('leaves the top-level declarations for the body to read', () => {
            expect(exported('let n = 1\nconst f = x => x\n{ let hidden = 2 }'))
                .toEqual(['f', 'n']);
        });
    });

    describe('destructuring', () => {
        it('types an array pattern by the element', () => {
            expect(codes('const [a, b] = ["x", "y"]\nlet n = a.length')).toEqual([]);
            expect(codes('const [a] = ["x"]\nlet n = a.nope')).toEqual(['type.unknown-member']);
        });

        it('types a record pattern field by field', () => {
            expect(codes('const {a, b: c} = {a: 1, b: "x"}\nlet n = c.length')).toEqual([]);
            expect(codes('const {b} = {a: 1}')).toEqual(['type.unknown-field']);
            expect(codes('const {b} = content')).toEqual(['stmt.not-destructurable']);
        });
    });

    describe('functions', () => {
        it('binds a declared arrow and lets it be called', () => {
            expect(codes('const f = x => x + 1\nlet y = f(1)')).toEqual([]);
            expect(codes('const f = x => { return x }\nlet y = f(1)')).toEqual([]);
        });

        // 関数は StaticType を持たない。だから配列にもレコードにも入れられず、
        // 段 3 のセルにも入らない。境界ごとに弾く処理を書かずに閉じている。
        it('refuses a function anywhere a value is expected', () => {
            expect(codes('const f = x => x\nlet y = f')).toEqual(['expr.fn-not-a-value']);
            expect(codes('const f = x => x\nlet xs = [f]')).toEqual(['expr.fn-not-a-value']);
            expect(codes('const f = x => x\nlet r = {a: f}')).toEqual(['expr.fn-not-a-value']);
            expect(codes('const f = x => x\nlet y = f(1) + f')).toEqual(['expr.fn-not-a-value']);
        });

        it('refuses a write to a function, and a pattern that takes one apart', () => {
            expect(codes('let f = x => x\nf = 2')).toEqual(['stmt.assign-to-function']);
            expect(codes('const [f] = ["a"]\nlet y = f(1)')).toEqual(['type.not-callable']);
        });

        it('counts the arguments', () => {
            expect(codes('const f = (a, b) => a\nlet y = f(1)')).toEqual(['type.call-arity']);
            expect(codes('const f = a => a\nlet y = f(1, 2)')).toEqual(['type.call-arity']);
        });

        it('names what a call could not resolve to', () => {
            expect(codes('let v = 1\nlet y = v(1)')).toEqual(['type.not-callable']);
            expect(codes('let y = nope(1)')).toEqual(['expr.unknown-ident']);
        });

        // 呼び出しごとではなく宣言で 1 回。引数の型は知りようがない（注釈が無く
        // 呼び出し側から戻ってこない）ので未知として束縛し、名前と対象外構文は
        // 捕まえ、引数の形に依存する話は言わない。
        it('reads the body once, at the declaration', () => {
            expect(codes('const f = x => { let y = nope\nreturn y }')).toEqual(['expr.unknown-ident']);
            expect(codes('const f = x => content.nope')).toEqual(['type.unknown-member']);
            expect(codes('const f = x => x.anything')).toEqual([]);
        });
    });

    describe('control flow', () => {
        it('requires a bool condition', () => {
            expect(codes('if (content) { }')).toEqual(['type.cond-not-bool']);
            expect(codes('while (1) { break }')).toEqual(['type.cond-not-bool']);
            expect(codes('let ok = true\nif (ok) { }')).toEqual([]);
        });

        // 条件に直接置いた代入は == の打ち間違いのほうが多い。二重括弧が
        // 「書き込むつもり」の言い方。
        it('warns about an assignment written straight into a condition', () => {
            const found = check('let ok = false\nif (ok = true) { }');
            expect(found.map(d => [d.code, d.severity])).toEqual([['stmt.assign-in-condition', 'warning']]);
            expect(codes('let ok = false\nif ((ok = true)) { }')).toEqual([]);
            expect(codes('let ok = false\nwhile ((ok = false)) { }')).toEqual([]);
        });

        it('refuses break and continue outside a loop', () => {
            expect(codes('break')).toEqual(['stmt.break-not-in-loop']);
            expect(codes('continue')).toEqual(['stmt.continue-not-in-loop']);
            expect(codes('for (const x of [1]) { break\ncontinue }')).toEqual([]);
            // 関数の中は別。外側のループはここまで届かない。
            expect(codes('for (const x of [1]) { const f = y => { break } }'))
                .toEqual(['stmt.break-not-in-loop']);
        });
    });
});
