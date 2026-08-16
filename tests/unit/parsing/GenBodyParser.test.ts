import { describe, it, expect } from 'vitest';
import type { StaticType } from '../../../src/services/lang/functions';
import { parseGenBody } from '../../../src/services/parsing/gen/GenBodyParser';

/** Bodies start at line 1 in these tests (the delimiter is line 0). */
const parse = (body: string[]) => parseGenBody(body, 1);
const codes = (body: string[]) => parse(body).diagnostics.map(d => [d.code, d.line]);

describe('parseGenBody — depth', () => {
    it('reads the depth-0 task line as the parent and the rest as children', () => {
        const { parent, children, diagnostics } = parse([
            '- [ ] 週報 ${start}',
            '    - [ ] 資料集め',
            '\t- [ ] 下書き',
        ]);
        expect(diagnostics).toEqual([]);
        expect(parent).toMatchObject({ depth: 0, text: '- [ ] 週報 ${start}', line: 1 });
        expect(children).toMatchObject([
            { depth: 1, text: '- [ ] 資料集め', line: 2 },
            { depth: 1, text: '- [ ] 下書き', line: 3 },
        ]);
        // 差し込みは読んだ時点で分けてある。位置は行頭からの絶対位置なので、
        // エディタがそのまま下線を引ける
        expect(parent!.parts.map(p => p.kind)).toEqual(['text', 'expr']);
        const interpolation = parent!.parts[1];
        expect(interpolation.kind === 'expr' && interpolation.expr).toMatchObject({ kind: 'prop', name: 'start' });
        expect(interpolation.kind === 'expr' && interpolation.expr.span)
            .toEqual({ start: '- [ ] 週報 ${'.length, end: '- [ ] 週報 ${start'.length });
        expect(children[0].parts).toEqual([{ kind: 'text', text: '- [ ] 資料集め' }]);
    });

    it('counts a tab and four spaces as one level each', () => {
        expect(parse([
            '- [ ] 親',
            '\t- [ ] 1段',
            '        - [ ] 2段',
            '\t\t\t- [ ] 3段',
        ]).children.map(c => c.depth)).toEqual([1, 2, 3]);
    });

    it('rounds a ragged indent up, so a 2-space line is a child, not a sibling', () => {
        const { children, diagnostics } = parse([
            '- [ ] 親',
            '  - [ ] 2スペース',
        ]);
        expect(children[0].depth).toBe(1);
        expect(diagnostics.map(d => d.code)).toEqual(['gen.ragged-indent']);
    });

    it('warns about mixed tabs and spaces', () => {
        expect(codes(['- [ ] 親', '\t  - [ ] 混在'])).toEqual([['gen.ragged-indent', 2]]);
    });

    it('drops blank lines', () => {
        const { children } = parse(['- [ ] 親', '', '    - [ ] 子', '   ']);
        expect(children.map(c => c.text)).toEqual(['- [ ] 子']);
    });

    it('keeps interpolations and trailing text verbatim', () => {
        expect(parse(['- [ ] 第${n + 1}回 @${start}']).parent!.text)
            .toBe('- [ ] 第${n + 1}回 @${start}');
    });
});

describe('parseGenBody — children-only blocks', () => {
    it('has no parent and reports nothing', () => {
        const { parent, children, diagnostics } = parse([
            '    - [ ] 資料集め',
            '    - [ ] 下書き',
        ]);
        expect(parent).toBeNull();
        expect(children).toHaveLength(2);
        expect(diagnostics).toEqual([]);
    });
});

describe('parseGenBody — diagnostics', () => {
    it('reports a second depth-0 line', () => {
        expect(codes([
            '- [ ] 親',
            '    - [ ] 子',
            '- [ ] もう1つの親',
        ])).toEqual([['gen.multiple-roots', 3]]);
    });

    it('reports a depth-0 line that is not a checkbox', () => {
        expect(codes(['見出しのような行', '    - [ ] 子'])).toEqual([['gen.root-not-a-task', 1]]);
    });

    it('reports a parent that comes after its children', () => {
        expect(codes([
            '    - [ ] 子',
            '- [ ] 親',
        ])).toEqual([['gen.root-not-first', 2]]);
    });

    it('reads a js section and keeps it out of the body', () => {
        const { parent, children, js, diagnostics } = parse([
            '<js>',
            'let n = 1',
            'n = n + 1',
            '</js>',
            '- [ ] 週報 第${n}回',
            '    - [ ] 資料集め',
        ]);
        expect(diagnostics).toEqual([]);
        expect(js!.program.body.map(s => s.kind)).toEqual(['decl', 'expr']);
        expect(parent!.text).toBe('- [ ] 週報 第${n}回');
        expect(children.map(c => c.text)).toEqual(['- [ ] 資料集め']);
    });

    it('does not swallow the body when the section closes on its own line', () => {
        const { parent, js } = parse(['<js>let n = 1</js>', '- [ ] 週報']);
        expect(parent!.text).toBe('- [ ] 週報');
        expect(js!.program.body).toHaveLength(1);
    });

    // セクションのソースは行をまたぐので、文字オフセットを行に写す必要がある。
    it('puts a diagnostic from inside the section on its own line', () => {
        const found = parse([
            '<js>',
            'let n = 1',
            'var m = 2',
            '</js>',
            '- [ ] 週報',
        ]).diagnostics;
        expect(found.map(d => [d.code, d.line])).toEqual([['stmt.no-var', 3]]);
        expect(found[0].endLine).toBeUndefined();
    });

    // セクションは複数行なので、span が行をまたぐことがある。両端を運ぶ
    // （開始行へ寄せて切り詰めると、あとで行ごとに切り直せない）。
    it('carries both ends of a span that crosses lines', () => {
        const found = parse([
            '<js>',
            'let ok = false',
            'if (ok =',
            'true) { }',
            '</js>',
            '- [ ] 週報',
        ]).diagnostics;
        expect(found.map(d => [d.code, d.line, d.endLine]))
            .toEqual([['stmt.assign-in-condition', 3, 4]]);
        // 開始行の桁と終了行の桁。'if (' の後から 'true' の後まで。
        expect(found[0].span).toEqual({ start: 4, end: 4 });
    });

    it('reports a section that never closes', () => {
        expect(codes(['<js>', 'let n = 1']).map(([code]) => code))
            .toContain('gen.js-section-unclosed');
    });

    it('reports a second section, and one written after the body', () => {
        expect(codes([
            '<js>', 'let n = 1', '</js>',
            '<js>', 'let m = 2', '</js>',
            '- [ ] 週報',
        ])).toEqual([['gen.js-section-duplicate', 4]]);
        expect(codes([
            '- [ ] 週報',
            '<js>', 'let n = 1', '</js>',
        ])).toEqual([['gen.js-section-after-body', 2]]);
    });

    // markdown のフェンスは行頭でしか閉じない。文字列の途中のバッククォート
    // 3 本は何も壊さないので、何も言わない。
    it('says nothing about backticks inside a string', () => {
        expect(codes(['<js>', 'const s = "```"', '</js>', '- [ ] 週報'])).toEqual([]);
    });

    // 行頭のフェンスは外側の tv-gen フェンスを閉じるので、そこでブロックが
    // 終わる。残るのは閉じていないセクションだけで、それが観測できる唯一の
    // 症状になる。案内はその文言が持つ。
    it('points a section that never closes at the fence that may have cut it', () => {
        const found = parse(['<js>', 'let n = 1']).diagnostics;
        expect(found.map(d => d.code)).toContain('gen.js-section-unclosed');
        expect(found[0].message).toContain('four or more backticks');
    });

    // ブロックの差し込みは、段 2b で初めて静的検査を受ける。
    it('checks the body interpolations against what the section declared', () => {
        expect(parse(['<js>', 'const n = 1', '</js>', '- [ ] 第${n}回']).diagnostics).toEqual([]);
        expect(codes(['- [ ] 第${n}回'])).toEqual([['expr.unknown-ident', 1]]);
        expect(codes(['<js>', 'const n = 1', '</js>', '- [ ] ${n.nope}']))
            .toEqual([['type.unknown-member', 4]]);
    });

    it('stays quiet about the body when the section itself is broken', () => {
        // セクションの束縛が分からない状態で本文を検査すると、借りている名前が
        // 全部 unknown になって本命の診断が埋もれる。
        expect(codes(['<js>', 'let 1 = 2', '</js>', '- [ ] 第${n}回']))
            .toEqual([['stmt.expected-binding', 2]]);
    });

    it('keeps a line starting with % as ordinary content', () => {
        const { parent, diagnostics } = parse(['- [ ] 進捗 50% 完了', '    % のメモ']);
        expect(diagnostics).toEqual([]);
        expect(parent!.text).toBe('- [ ] 進捗 50% 完了');
    });

    it('reports diagnostics in line order', () => {
        expect(codes([
            '  - [ ] 端数',
            '- [ ] 親',
        ])).toEqual([['gen.ragged-indent', 1], ['gen.root-not-first', 2]]);
    });
});

describe('parseGenBody — the cells the command declares', () => {
    const cells = new Map<string, StaticType>([['n', 'number']]);
    const withCells = (body: string[]) => parseGenBody(body, 1, cells);
    const cellCodes = (body: string[]) => withCells(body).diagnostics.map(d => [d.code, d.line]);

    it('reads a cell through state, in the body and in the section', () => {
        // ブロックはどのコマンドが自分を使うか知らないので、名前は外から来る。
        // 渡し忘れると全部『宣言されていないセル』になる（沈黙しない）。
        expect(withCells(['- [ ] 第${state.n = state.n + 1}回']).diagnostics).toEqual([]);
        expect(withCells(['- [ ] 第${state.n += 1}回']).diagnostics).toEqual([]);
        expect(withCells(['<js>', 'state.n = state.n + 1', '</js>', '- [ ] 第${state.n}回']).diagnostics).toEqual([]);
    });

    it('names the cell that was meant when the prefix is missing', () => {
        // 改名前の書き方をそのまま持ってきた人が最初に踏む形。宣言の集合を
        // 持っているので、未知の名前ではなく『それはセルだ』と言える。
        expect(cellCodes(['- [ ] 第${n}回'])).toEqual([['expr.cell-needs-state', 1]]);
        expect(cellCodes(['<js>', 'n = 1', '</js>', '- [ ] 週報'])).toEqual([['expr.cell-needs-state', 2]]);
    });

    it('still calls a name no command declares what it is', () => {
        expect(cellCodes(['- [ ] 第${m}回'])).toEqual([['expr.unknown-ident', 1]]);
        expect(cellCodes(['<js>', 'm = 1', '</js>', '- [ ] 週報'])).toEqual([['stmt.assign-undeclared', 2]]);
    });

    it('names a cell the command does not declare', () => {
        expect(cellCodes(['- [ ] 第${state.m}回'])).toEqual([['expr.unknown-cell', 1]]);
    });

    it('says so differently when the command declares no cells at all', () => {
        // 宣言が 1 つも無いのは書き忘れで、綴り違いとは別の話。
        expect(parseGenBody(['- [ ] 第${state.n}回'], 1, undefined).diagnostics.map(d => d.code))
            .toEqual(['expr.no-cells-declared']);
    });

    it('knows what type a cell holds', () => {
        expect(cellCodes(['<js>', 'state.n = "text"', '</js>', '- [ ] 週報']))
            .toEqual([['stmt.assign-type-change', 2]]);
    });

    it('reads a cell called state, which is only reachable through the prefix', () => {
        const named = new Map<string, StaticType>([['state', 'number']]);
        expect(parseGenBody(['- [ ] 第${state.state}回'], 1, named).diagnostics).toEqual([]);
    });

    it('lets a section declare the same name without touching the cell', () => {
        // 改名の眼目。セルはスコープに居ないので、この宣言は隠していない。
        // 別物として普通に読み書きされ、セルは state.n のまま動き続ける。
        expect(cellCodes(['<js>', 'let n = 0', 'n = n + 1', '</js>', '- [ ] 第${state.n}回']))
            .toEqual([]);
        expect(cellCodes(['<js>', 'const xs = [1, 2].map(n => n + 1)', '</js>', '- [ ] 週報']))
            .toEqual([]);
    });

    it('refuses a declaration of state itself', () => {
        // 隠すと state.n が全部その宣言を読み、コマンドの値は動かなくなる。
        // ほかの名前を隠すのは警告だが、これは error。
        expect(cellCodes(['<js>', 'let state = 1', '</js>', '- [ ] 週報']))
            .toEqual([['stmt.shadows-state', 2]]);
    });

    it('refuses a value that could never be printed back', () => {
        // 実行時のガードは残る（型が unknown に広がる経路があるため）。
        // 書いている時点で決まるものは、書いている時点で言う。
        expect(cellCodes(['<js>', 'state.n = [1, 2]', '</js>', '- [ ] 週報']))
            .toEqual([['type.cell-not-storable', 2]]);
        expect(cellCodes(['<js>', 'state.n = {a: 1}', '</js>', '- [ ] 週報']))
            .toEqual([['type.cell-not-storable', 2]]);
    });
});

describe('parseGenBody — the js section is written as a tag', () => {
    it('reads the whole section written on one line', () => {
        const { parent, js, diagnostics } = parse(['<js>let n = 1</js>', '- [ ] 第${n}回']);
        expect(diagnostics).toEqual([]);
        expect(js!.program.body).toHaveLength(1);
        expect(parent!.text).toBe('- [ ] 第${n}回');
    });

    // タグを剥がすと、その行に書いたコードだけが左へずれていた。同じ長さの
    // 空白に置き換えてあるので、セクションの桁はページの桁と一致する。
    it('keeps the columns of code written on the opening line', () => {
        const found = parse(['<js>var m = 2', '</js>', '- [ ] 週報']).diagnostics;
        expect(found.map(d => [d.code, d.line])).toEqual([['stmt.no-var', 1]]);
        expect(found[0].span.start).toBe('<js>'.length);
    });

    // 旧記法はもう区切りではない。黙って通らず、本文の行として読まれる。
    it('reads the old delimiters as body lines, which the block then refuses', () => {
        expect(codes(['<js', 'let n = 1', '/js>', '- [ ] 週報'])).toEqual([
            ['gen.root-not-a-task', 1],
            ['gen.multiple-roots', 2],
            ['gen.multiple-roots', 3],
            ['gen.multiple-roots', 4],
        ]);
    });

    it('refuses a section written between the body lines', () => {
        expect(codes([
            '- [ ] 親',
            '<js>', 'let n = 1', '</js>',
            '    - [ ] 子',
        ])).toEqual([['gen.js-section-after-body', 2]]);
    });
});

describe('parseGenBody — a block with no body lines', () => {
    // 本文が 1 行も無いブロックは、計算した値をどこにも置けない。以前は何も
    // 言わずに通り、発火すると元のタスクの複製ができていた。
    it('reports a section with nothing after it, under its opening tag', () => {
        const found = parse(['<js>', 'let n = 1', '</js>']).diagnostics;
        expect(found.map(d => [d.code, d.line])).toEqual([['gen.empty-body', 1]]);
        expect(found[0].span).toEqual({ start: 0, end: '<js>'.length });
    });

    // 下線を引ける文字が 1 つも無い形。行の上に文字が無いマークは描かれる前に
    // 捨てられるので、本文の 1 つ前の行 = 開きのフェンスに付ける。
    it('reports a block that is empty, or only blank lines, on its fence', () => {
        for (const body of [[], ['', '   ']]) {
            const found = parseGenBody(body, 1).diagnostics;
            expect(found.map(d => [d.code, d.line])).toEqual([['gen.empty-body', 0]]);
            expect(found[0].span).toEqual({ start: 0, end: 3 });
        }
    });

    // 判定は本文の行数で、親の有無ではない。子だけ書くブロックは機能なので、
    // 親が null でも当たらないこと。
    it('says nothing about a block that writes only children', () => {
        expect(codes(['    - [ ] 資料集め', '    - [ ] 下書き'])).toEqual([]);
    });
});
