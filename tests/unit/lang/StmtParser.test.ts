import { describe, it, expect } from 'vitest';
import { Diagnostic } from '../../../src/services/lang/Diagnostic';
import { parseProgram } from '../../../src/services/lang/StmtParser';
import { Stmt } from '../../../src/services/lang/StmtAst';

/** Parse and require a clean read — the shape assertions below start here. */
function ok(src: string): Stmt[] {
    const { program, diagnostics } = parseProgram(src);
    expect(diagnostics).toEqual([]);
    return program.body;
}

function codes(src: string): string[] {
    return parseProgram(src).diagnostics.map(d => d.code);
}

function first(src: string): Diagnostic {
    const { diagnostics } = parseProgram(src);
    expect(diagnostics.length).toBeGreaterThan(0);
    return diagnostics[0];
}

describe('StmtParser', () => {
    describe('declarations', () => {
        it('reads let and const', () => {
            expect(ok('let x = 1')).toMatchObject([
                { kind: 'decl', mutable: true, target: { kind: 'name', name: 'x' }, init: { kind: 'lit' } },
            ]);
            expect(ok('const x = 1')).toMatchObject([{ kind: 'decl', mutable: false }]);
        });

        it('binds none for a let with no value, as JS does', () => {
            expect(ok('let x')).toMatchObject([{ kind: 'decl', mutable: true, init: null }]);
        });

        it('requires a const to have its value here', () => {
            expect(codes('const x')).toEqual(['stmt.const-needs-init']);
        });

        it('reads the basic array pattern, holes included', () => {
            expect(ok('let [a, , b] = xs')).toMatchObject([{
                kind: 'decl',
                target: { kind: 'array-pattern', names: [{ name: 'a' }, null, { name: 'b' }] },
            }]);
        });

        it('reads the basic record pattern, renaming included', () => {
            expect(ok('const {a, b: c} = rec')).toMatchObject([{
                kind: 'decl',
                target: { kind: 'record-pattern', fields: [{ key: 'a', name: 'a' }, { key: 'b', name: 'c' }] },
            }]);
        });

        it('requires a pattern to have something to take apart', () => {
            expect(codes('let [a, b]')).toEqual(['stmt.pattern-needs-init']);
        });

        it('names what a pattern expected when it is not a name', () => {
            expect(first('let 1 = 2').code).toBe('stmt.expected-binding');
            expect(first('let {1: a} = xs').code).toBe('stmt.expected-field-binding');
            expect(first('let [a b] = xs').code).toBe('stmt.expected-rbracket-pattern');
            expect(first('let {a 1} = xs').code).toBe('stmt.expected-rbrace-pattern');
        });
    });

    describe('expressions in statement position', () => {
        it('reads an assignment, which is an expression', () => {
            expect(ok('n = n + 1')).toMatchObject([
                { kind: 'expr', expr: { kind: 'assign', op: '=', name: 'n' } },
            ]);
            expect(ok('n += 1')).toMatchObject([{ kind: 'expr', expr: { kind: 'assign', op: '+=' } }]);
            expect(ok('n -= 1')).toMatchObject([{ kind: 'expr', expr: { kind: 'assign', op: '-=' } }]);
        });

        it('binds assignment to the right', () => {
            expect(ok('n = m = 1')).toMatchObject([
                { kind: 'expr', expr: { kind: 'assign', name: 'n', value: { kind: 'assign', name: 'm' } } },
            ]);
        });

        it('assigns to a variable and nothing else', () => {
            expect(codes('1 = 2')).toEqual(['expr.assign-target']);
            expect(codes('x.y = 1')).toEqual(['expr.assign-target']);
            expect(codes('xs[0] = 1')).toEqual(['expr.assign-target']);
        });

        it('reads a call of a locally declared function', () => {
            expect(ok('const f = x => x + 1\nlet y = f(2)')).toMatchObject([
                { kind: 'decl', target: { name: 'f' } },
                { kind: 'decl', target: { name: 'y' }, init: { kind: 'call-local', name: 'f', args: [{ kind: 'lit' }] } },
            ]);
        });

        it('names the callee when its arguments are not closed', () => {
            const d = first('let y = f(2');
            expect(d.code).toBe('expr.expected-rparen-call');
            expect(d.params).toMatchObject({ fn: 'f' });
        });
    });

    describe('if / else', () => {
        it('reads if, else if and else', () => {
            expect(ok('if (a) { b = 1 } else if (c) { b = 2 } else { b = 3 }')).toMatchObject([{
                kind: 'if',
                then: [{ kind: 'expr' }],
                alt: [{ kind: 'if', alt: [{ kind: 'expr' }] }],
            }]);
        });

        it('reads an else on its own line', () => {
            expect(ok('if (a) {\n b = 1\n}\nelse {\n b = 2\n}')).toMatchObject([
                { kind: 'if', alt: [{ kind: 'expr' }] },
            ]);
        });

        // else を探すために改行を読み飛ばすと、else が無かったときに文の終端まで
        // 食べてしまう。次の文が丸ごと落ちる形なので、先読みだけで判定する。
        it('leaves the line break alone when no else follows', () => {
            expect(ok('if (a) { b = 1 }\nlet x = 2')).toMatchObject([
                { kind: 'if', alt: null },
                { kind: 'decl', target: { name: 'x' } },
            ]);
            expect(ok('if (a) {\n if (b) {\n c = 1\n }\n}\nlet d = 2')).toHaveLength(2);
        });

        it('requires the parentheses and the braces', () => {
            expect(first('if a { b = 1 }')).toMatchObject({
                code: 'stmt.expected-lparen', params: { what: 'if' },
            });
            expect(first('if (a { b = 1 }')).toMatchObject({
                code: 'stmt.expected-rparen', params: { what: 'if' },
            });
            expect(first('if (a) b = 1')).toMatchObject({
                code: 'stmt.body-needs-braces', params: { what: 'if' },
            });
        });

        it('keeps an assignment in the condition rather than mangling it', () => {
            // 診断は 2b の検査器の担当（二重括弧で消える warning）。ここでは
            // 形が保たれることだけを見る。
            expect(ok('if (n = 1) { x = 2 }')).toMatchObject([{ kind: 'if', cond: { kind: 'assign' } }]);
            expect(ok('if ((n = 1)) { x = 2 }')).toMatchObject([{ kind: 'if', cond: { kind: 'assign' } }]);
        });
    });

    describe('while / for', () => {
        it('reads while with break and continue', () => {
            expect(ok('while (a) {\n break\n continue\n}')).toMatchObject([
                { kind: 'while', body: [{ kind: 'break' }, { kind: 'continue' }] },
            ]);
        });

        it('reads for-of, with a pattern too', () => {
            expect(ok('for (const x of xs) { y = x }')).toMatchObject([
                { kind: 'for-of', mutable: false, target: { kind: 'name', name: 'x' }, iterable: { kind: 'var', name: 'xs' } },
            ]);
            expect(ok('for (let [a, b] of xs) { y = a }')).toMatchObject([
                { kind: 'for-of', mutable: true, target: { kind: 'array-pattern' } },
            ]);
        });

        it('reads the classic head, with every slot optional', () => {
            expect(ok('for (let i = 0; i < n; i += 1) { y = i }')).toMatchObject([{
                kind: 'for',
                init: { kind: 'decl', target: { name: 'i' } },
                cond: { kind: 'binary', op: '<' },
                update: { kind: 'assign', op: '+=' },
            }]);
            expect(ok('for (;;) { break }')).toMatchObject([
                { kind: 'for', init: null, cond: null, update: null },
            ]);
            expect(ok('for (i = 0; i < n; i += 1) { y = i }')).toMatchObject([
                { kind: 'for', init: { kind: 'expr' } },
            ]);
        });

        it('points a for-in at for-of', () => {
            const d = first('for (const x in xs) { y = x }');
            expect(d.code).toBe('stmt.expected-semicolon');
            expect(d.message).toContain('for-of');
        });

        it('names each piece of the head it could not find', () => {
            expect(first('for x of xs { y = 1 }')).toMatchObject({
                code: 'stmt.expected-lparen', params: { what: 'for' },
            });
            expect(first('for (const x of xs { y = 1 }').code).toBe('stmt.expected-rparen-head');
            expect(first('for (let i = 0; i < n i += 1) { y = 1 }').code).toBe('stmt.expected-second-semicolon');
            expect(first('for (let i = 0; i < n; i += 1) y = 1').code).toBe('stmt.body-needs-braces');
        });
    });

    describe('blocks and records', () => {
        it('reads a bare brace as a scope', () => {
            expect(ok('{ let x = 1 }')).toMatchObject([{ kind: 'block', body: [{ kind: 'decl' }] }]);
            expect(ok('{ }')).toMatchObject([{ kind: 'block', body: [] }]);
        });

        // 文の位置の { はブロック。レコードのつもりで書いた形は、ブロックとして
        // 壊れた診断を並べるのではなく、修正形を 1 本示して読み切る。
        it('answers a record written where a block is read', () => {
            expect(codes('{a: 1}')).toEqual(['stmt.record-needs-parens']);
            expect(codes('{\n a: 1,\n b: 2\n}')).toEqual(['stmt.record-needs-parens']);
            expect(parseProgram('{a: 1}').program.body).toMatchObject([
                { kind: 'expr', expr: { kind: 'record' } },
            ]);
        });

        it('does not mistake a block whose first statement starts with a name', () => {
            expect(ok('{ a ? b : c }')).toMatchObject([{ kind: 'block' }]);
            expect(ok('{ a = 1 }')).toMatchObject([{ kind: 'block' }]);
        });

        it('reads a record where a value is expected, unchanged', () => {
            expect(ok('let r = {a: 1}')).toMatchObject([{ kind: 'decl', init: { kind: 'record' } }]);
        });
    });

    describe('arrow bodies and return', () => {
        it('reads a block body as statements', () => {
            expect(ok('const f = x => { let y = x\n return y }')).toMatchObject([{
                kind: 'decl',
                init: { kind: 'arrow', params: ['x'], body: { kind: 'block-body', body: [{ kind: 'decl' }, { kind: 'return' }] } },
            }]);
        });

        it('keeps the expression body it always had', () => {
            expect(ok('const f = x => x + 1')).toMatchObject([
                { kind: 'decl', init: { kind: 'arrow', body: { kind: 'binary' } } },
            ]);
        });

        it('reads a bare return', () => {
            expect(ok('const f = x => { return }')).toMatchObject([
                { kind: 'decl', init: { kind: 'arrow', body: { body: [{ kind: 'return', value: null }] } } },
            ]);
        });

        it('sends a top-level return to the body interpolation', () => {
            const d = first('return 1');
            expect(d.code).toBe('stmt.return-not-here');
            expect(d.message).toContain('${');
            expect(codes('return')).toEqual(['stmt.return-not-here']);
        });

        it('names the function body when its brace is missing', () => {
            expect(first('const f = x => { return x').code).toBe('stmt.expected-rbrace-fn');
        });
    });

    describe('constructs this language does not have', () => {
        // 1 構文 1 code。除外リストの値打ちは、踏んだときに代替を示せるかで
        // 決まるので、code を共有すると訳が 1 つしか置けなくなる。
        const REFUSED: [string, string][] = [
            ['var x = 1', 'stmt.no-var'],
            ['function f() { }', 'stmt.no-function'],
            ['class A { }', 'stmt.no-class'],
            ['try { x = 1 }', 'stmt.no-try'],
            ['throw 1', 'stmt.no-throw'],
            ['switch (x) { }', 'stmt.no-switch'],
            ['do { x = 1 } while (a)', 'stmt.no-do'],
            ['async function f() { }', 'stmt.no-async'],
            ['import x from "y"', 'stmt.no-import'],
            ['export const x = 1', 'stmt.no-export'],
            ['const d = new Date()', 'expr.no-new'],
            ['let t = Date.now()', 'expr.no-date'],
            ['console.log(1)', 'expr.no-console'],
            ['let f = function () { }', 'expr.no-function'],
            ['let v = await x', 'expr.no-await'],
            ['let t = typeof x', 'expr.no-typeof'],
            ['delete x.y', 'expr.no-delete'],
        ];

        it.each(REFUSED)('refuses %s with its own code', (src, code) => {
            expect(first(src).code).toBe(code);
        });

        it('sends ++ and -- to the compound assignment that returns the new value', () => {
            for (const [src, fix] of [['n++', '+= 1'], ['++n', '+= 1'], ['n--', '-= 1']]) {
                const d = first(src);
                expect(d.code).toBe('expr.increment-not-here');
                expect(d.params).toMatchObject({ fix });
            }
        });

        it('reads undefined and null as the missing value', () => {
            expect(ok('let x = undefined')).toMatchObject([{ init: { kind: 'lit', value: { type: 'none' } } }]);
            expect(ok('let x = null')).toMatchObject([{ init: { kind: 'lit', value: { type: 'none' } } }]);
        });

        it('refuses a block comment and keeps the line comment', () => {
            expect(codes('let x = 1 /* c */')).toEqual(['lex.no-block-comment']);
            expect(ok('// leading\nlet x = 1 // trailing\nlet y = 2')).toHaveLength(2);
        });
    });

    // 文は改行で終わる。挿入も推測もしないので、「どこで終わったか」は
    // 括弧の開閉だけで決まる。
    describe('statement boundaries (no semicolon insertion)', () => {
        it('ends a statement at the line break', () => {
            expect(ok('let x = 1\nlet y = 2')).toHaveLength(2);
        });

        it('takes a semicolon as the same boundary, and an empty one as nothing', () => {
            expect(ok('let x = 1;let y = 2')).toHaveLength(2);
            expect(ok('let x = 1;;let y = 2')).toHaveLength(2);
            expect(ok('let x = 1 ;')).toHaveLength(1);
        });

        it('ignores blank lines around and between statements', () => {
            expect(ok('\n\nlet x = 1\n\n\nlet y = 2\n\n')).toHaveLength(2);
        });

        it('carries a statement across a line break inside ( or [', () => {
            expect(ok('let x = (1 +\n2)')).toMatchObject([{ init: { kind: 'binary' } }]);
            expect(ok('let x = [1,\n2]')).toMatchObject([{ init: { kind: 'array', items: [{}, {}] } }]);
            expect(ok('let r = Math.max(1,\n2)')).toHaveLength(1);
            expect(ok('for (let i = 0;\n i < n;\n i += 1) {\n y = i\n}')).toHaveLength(1);
        });

        it('carries a record across a line break, whose braces the lexer cannot tell from a block', () => {
            expect(ok('let r = {a: 1,\nb: 2}')).toMatchObject([{ init: { kind: 'record', entries: [{}, {}] } }]);
            expect(ok('let r = {\n a: 1,\n b: 2\n}')).toHaveLength(1);
        });

        // 括弧の内側でも、いま開いているのが波括弧なら、そこは文の場所。
        it('keeps statement boundaries inside a block nested in a call or a list', () => {
            expect(ok('const ys = xs.map(x => {\n let y = x\n return y\n})')).toHaveLength(1);
            expect(ok('const ys = [x => {\n let y = 1\n return y\n}]')).toHaveLength(1);
        });

        it('keeps a line break inside a template literal out of it', () => {
            expect(ok('let s = `a\nb`')).toMatchObject([{ init: { kind: 'template' } }]);
        });

        it('does not bridge a line break with every bracket closed', () => {
            expect(codes('let x = 1 +\n2')).toEqual(['stmt.unexpected-line-break']);
        });

        it('says so when a statement has more after it on the same line', () => {
            const d = first('let x = 1 let y = 2');
            expect(d.code).toBe('stmt.expected-end');
            expect(d.params).toMatchObject({ token: 'let' });
        });

        it('reads CRLF as one boundary', () => {
            expect(ok('let x = 1\r\nlet y = 2')).toHaveLength(2);
        });
    });

    describe('recovery', () => {
        it('reports a broken statement and reads the next one', () => {
            const { program, diagnostics } = parseProgram('let 1 = 2\nlet y = 3');
            expect(diagnostics).toHaveLength(1);
            expect(program.body).toMatchObject([{ kind: 'decl', target: { name: 'y' } }]);
        });

        it('reports a closing brace with nothing open, then keeps going', () => {
            const { program, diagnostics } = parseProgram('let x = 1\n}\nlet y = 2');
            expect(diagnostics.map(d => d.code)).toEqual(['stmt.unexpected-rbrace']);
            expect(program.body).toHaveLength(2);
        });

        it('names which brace was never closed', () => {
            expect(first('if (a) { b = 1').code).toBe('stmt.expected-rbrace-body');
            expect(first('{ let x = 1').code).toBe('stmt.expected-rbrace-block');
        });
    });
});
