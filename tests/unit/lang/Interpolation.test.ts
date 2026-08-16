import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../../../src/services/lang/Diagnostic';
import { FLOW_TYPE_ENV, checkExpr } from '../../../src/services/lang/ExprChecker';
import type { EvalContext } from '../../../src/services/lang/ExprEvaluator';
import { parseExpr, splitInterpolations } from '../../../src/services/lang/ExprParser';
import { printExpr } from '../../../src/services/lang/ExprPrinter';
import { renderInterpolation, renderInterpolationText } from '../../../src/services/lang/Interpolation';
import { findInterpolationEnd, scanInterpolations, tokenize } from '../../../src/services/lang/Lexer';
import { TokenCursor } from '../../../src/services/lang/Token';
import type { EvalHost } from '../../../src/services/lang/functions';

const stubHost: EvalHost = {
    formatDate: (value, tokens) => `[${tokens}:${value.type === 'date' ? value.value : '?'}]`,
};

function ctx(props: EvalContext['props'] = {}): EvalContext {
    return {
        props,
        today: '2026-08-15',
        now: { date: '2026-08-15', time: '10:00' },
        weekStartDay: 1,
        host: stubHost,
    };
}

const codes = (ds: Diagnostic[]) => ds.map(d => d.code);

/** Written out so the escapes below read as what they are. */
const BACKSLASH = '\\';

function render(line: string, props: EvalContext['props'] = {}): string {
    const diagnostics: Diagnostic[] = [];
    const parts = splitInterpolations(line, diagnostics);
    expect(codes(diagnostics)).toEqual([]);
    return renderInterpolationText(parts, ctx(props));
}

describe('finding the end of an interpolation', () => {
    it('takes the brace that closes it, not the first one', () => {
        // 素朴に「最初の }」で切ると、関数本体やオブジェクトで切れる
        const src = '${xs.map(x => { return x })} tail';
        expect(findInterpolationEnd(src, 0)).toBe(src.indexOf('} tail'));
    });

    it('counts every bracket kind, not just braces', () => {
        // 波括弧だけ数えると、種別が増えた日に静かに切れる
        const src = '${ f(a[0], {k: 1}) } tail';
        expect(findInterpolationEnd(src, 0)).toBe(src.indexOf('} tail'));
    });

    it('skips braces inside strings, including nested templates', () => {
        expect(findInterpolationEnd('${"}"}', 0)).toBe(5);
        expect(findInterpolationEnd("${'}'}", 0)).toBe(5);
        const nested = '${`inner ${a} }`}';
        expect(findInterpolationEnd(nested, 0)).toBe(nested.length - 1);
    });

    it('reports the missing brace rather than guessing', () => {
        expect(findInterpolationEnd('${a', 0)).toBe(-1);
        const diagnostics: Diagnostic[] = [];
        splitInterpolations('- [ ] ${a', diagnostics);
        expect(codes(diagnostics)).toContain('gen.unterminated-interpolation');
    });
});

describe('scanning a line for its interpolations', () => {
    // 位置を答えるのはこの 1 か所で、開き記号の探し方もエスケープの規則も
    // ここにしかない。分割（構文解析つき）と装飾（構文解析なし）が同じ答えを
    // 見るのはそのため。
    const scanned = (text: string, offset = 0) =>
        scanInterpolations(text, offset).map(s => `${s.closed ? 'closed' : 'open'}:${text.slice(s.span.start - offset, s.span.end - offset)}`);

    it('finds each one where it was written', () => {
        expect(scanned('- [ ] ${a} と ${b}')).toEqual(['closed:${a}', 'closed:${b}']);
    });

    it('does not open one behind a backslash', () => {
        expect(scanned('- [ ] \\${start}')).toEqual([]);
        // 直前の 1 個だけが効くので、2 個並べても開かない
        expect(scanned('- [ ] \\\\${start}')).toEqual([]);
    });

    it('says an unclosed one opened, and stops there', () => {
        // どこまでが式かは決まらないので、開いたという事実だけを返す。後続は
        // その中身なのか外なのかが決められない
        expect(scanned('- [ ] ${format( と ${b}')).toEqual(['open:${']);
    });

    it('measures from where the text sits', () => {
        expect(scanInterpolations('${a}', 4)[0].span).toEqual({ start: 4, end: 8 });
    });
});

describe('interpolating a line', () => {
    it('keeps the literal text around each expression', () => {
        const diagnostics: Diagnostic[] = [];
        const parts = splitInterpolations('- [ ] ${content} の振り返り', diagnostics);
        expect(diagnostics).toEqual([]);
        expect(parts.map(p => p.kind)).toEqual(['text', 'expr', 'text']);
        expect(render('- [ ] ${content} の振り返り', { content: { type: 'string', value: '週報' } }))
            .toBe('- [ ] 週報 の振り返り');
    });

    it('renders a line with no expression as itself', () => {
        expect(render('- [ ] plain line')).toBe('- [ ] plain line');
    });

    it('leaves a backslash alone except right before an interpolation', () => {
        // バックスラッシュの用途は 1 つだけ。Windows のパスは書いたまま出る
        expect(render('C:\\new\\path')).toBe('C:\\new\\path');
        // 直前の 1 個だけが効く。エスケープしたぶんは消え、差し込みは起きない
        expect(render('- [ ] \\${start}')).toBe('- [ ] ${start}');
        // 2 個並べても、効くのは直前の 1 個。素のバックスラッシュが 1 個残る
        expect(render('- [ ] \\\\${start}')).toBe('- [ ] \\${start}');
    });

    it('refuses input it did not read to the end', () => {
        // フロー行では後続の ')' が偶然拾っていた。差し込みはその網の外なので、
        // 黙って a == b として生成しないためにここで閉じる。
        const diagnostics: Diagnostic[] = [];
        splitInterpolations('${1 == 2 == 3}', diagnostics);
        expect(codes(diagnostics).some(c => c === 'gen.trailing-input' || c === 'expr.comparison-chain')).toBe(true);

        const trailing: Diagnostic[] = [];
        splitInterpolations('${1 2}', trailing);
        expect(codes(trailing)).toContain('gen.trailing-input');
    });

    it('reports every broken interpolation on the line, not just the first', () => {
        const diagnostics: Diagnostic[] = [];
        splitInterpolations('${1 2} and ${3 4}', diagnostics);
        expect(codes(diagnostics).filter(c => c === 'gen.trailing-input')).toHaveLength(2);
    });

    it('points the diagnostic at the expression inside the line', () => {
        // 式は行頭ではなく ${ の内側から始まる。位置を足し忘れると、
        // 診断が行の先頭を指して読めなくなる。
        const line = '- [ ] ${1 == 2 == 3} tail';
        const diagnostics: Diagnostic[] = [];
        splitInterpolations(line, diagnostics);
        const d = diagnostics[0];
        expect(d.span.start).toBeGreaterThanOrEqual(line.indexOf('1 =='));
        expect(line.slice(d.span.start, d.span.end)).toContain('1 == 2');
    });

    it('hands back the pieces so a caller can see where a newline came from', () => {
        // 配列は「要素が行」。行の途中に来たかどうかは書き込み側が決める
        const diagnostics: Diagnostic[] = [];
        const parts = splitInterpolations('- ${["a", "b"]} tail', diagnostics);
        expect(diagnostics).toEqual([]);
        const rendered = renderInterpolation(parts, ctx());
        expect(rendered.map(p => p.fromExpr)).toEqual([false, true, false]);
        expect(rendered[1].text).toBe('a\nb');
    });
});

describe('template literals', () => {
    function parseBlock(src: string) {
        const { tokens, diagnostics } = tokenize(src);
        const expr = parseExpr(new TokenCursor(tokens), diagnostics, 'block');
        return { expr, diagnostics };
    }

    it('reads text and expressions between the backticks', () => {
        const { expr, diagnostics } = parseBlock('`第${n}回`');
        expect(diagnostics).toEqual([]);
        expect(expr).toMatchObject({ kind: 'template' });
        expect(printExpr(expr!)).toBe('`第${n}回`');
    });

    it('is not available in a flow command', () => {
        const { tokens, diagnostics } = tokenize('`a${1}b`');
        parseExpr(new TokenCursor(tokens), diagnostics, 'flow');
        expect(codes(diagnostics)).toContain('expr.template-not-here');
    });

    it('does not end on a backtick inside its own interpolation', () => {
        const { expr, diagnostics } = parseBlock('`outer ${["x"].map(s => `in ${s}`).join("")} end`');
        expect(diagnostics).toEqual([]);
        expect(expr).toMatchObject({ kind: 'template' });
    });

    it('escapes an interpolation and nothing else', () => {
        // 規則は 1 つ: バックスラッシュは差し込みの直前でだけ意味を持つ。
        // 任意の文字をエスケープする形にすると、末尾がバックスラッシュの
        // パスで閉じのバッククォートが食われる（設計がこの規則の動機に
        // 挙げた当のパスが書けなくなる）。
        const path = parseBlock('`C:BdirB`'.split('B').join(BACKSLASH));
        expect(path.diagnostics).toEqual([]);
        expect(path.expr).toMatchObject({
            kind: 'template',
            parts: [{ kind: 'text', text: 'C:BdirB'.split('B').join(BACKSLASH) }],
        });

        const literal = parseBlock('`C:BdirB${name}`'.split('B').join(BACKSLASH));
        expect(literal.diagnostics).toEqual([]);
        // 差し込みではなくリテラルのテキストになる（隣接する形は書けない）
        expect(literal.expr).toMatchObject({
            kind: 'template',
            parts: [{ kind: 'text', text: 'C:Bdir${name}'.split('B').join(BACKSLASH) }],
        });
    });

    it('cannot hold a backtick, which is what one rule costs', () => {
        // バックスラッシュがエスケープしないので、内側のバッククォートが
        // テンプレートを終わらせる。書きたいときは文字列と + で組む。
        const { diagnostics } = parseBlock('`aBb`'.split('B').join(BACKSLASH + '`'));
        expect(codes(diagnostics)).toContain('lex.unterminated-template');
    });

    it('prints the escape back so a literal stays literal', () => {
        const src = '`aB${b}`'.split('B').join(BACKSLASH);
        const { expr, diagnostics } = parseBlock(src);
        expect(diagnostics).toEqual([]);
        expect(printExpr(expr!)).toBe(src);
    });

    it('reports an unterminated template', () => {
        const { diagnostics } = parseBlock('`no end');
        expect(codes(diagnostics)).toContain('lex.unterminated-template');
    });

    it('types as a string and renders its pieces', () => {
        const { expr, diagnostics } = parseBlock('`- [ ] ${content}`');
        expect(checkExpr(expr!, FLOW_TYPE_ENV, diagnostics)).toBe('string');
        expect(diagnostics).toEqual([]);
    });

    it('builds the shape a generated child line needs', () => {
        // サンプル4（配列からの生成）が書く形
        const src = '["設計", "実装"].map(a => `    - [ ] ${a} の振り返り`).join("|")';
        const { tokens, diagnostics } = tokenize(src);
        const expr = parseExpr(new TokenCursor(tokens), diagnostics, 'block');
        expect(diagnostics).toEqual([]);
        expect(checkExpr(expr!, FLOW_TYPE_ENV, diagnostics)).toBe('string');
        expect(renderInterpolationText([{ kind: 'expr', expr: expr!, span: { start: 0, end: src.length } }], ctx()))
            .toBe('    - [ ] 設計 の振り返り|    - [ ] 実装 の振り返り');
    });
});
