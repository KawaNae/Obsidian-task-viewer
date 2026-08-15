import { describe, it, expect } from 'vitest';
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

    it('reports a js section as unsupported and skips it', () => {
        const { parent, children, diagnostics } = parse([
            '<js',
            'n = n + 1',
            '/js>',
            '- [ ] 週報 第${n}回',
            '    - [ ] 資料集め',
        ]);
        expect(diagnostics.map(d => [d.code, d.line])).toEqual([
            ['gen.js-section-unsupported', 1],
        ]);
        expect(parent!.text).toBe('- [ ] 週報 第${n}回');
        expect(children.map(c => c.text)).toEqual(['- [ ] 資料集め']);
    });

    it('does not swallow the body when the section closes on its own line', () => {
        const { parent } = parse(['<js n = n + 1 /js>', '- [ ] 週報']);
        expect(parent!.text).toBe('- [ ] 週報');
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
