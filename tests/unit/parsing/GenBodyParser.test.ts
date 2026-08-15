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
        expect(parent).toEqual({ depth: 0, text: '- [ ] 週報 ${start}', line: 1 });
        expect(children).toEqual([
            { depth: 1, text: '- [ ] 資料集め', line: 2 },
            { depth: 1, text: '- [ ] 下書き', line: 3 },
        ]);
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

    it('reports a statement line as unsupported and ignores it', () => {
        const { children, diagnostics } = parse([
            '- [ ] 親',
            '% if (n > 3) {',
            '    - [ ] 子',
            '% }',
        ]);
        expect(diagnostics.map(d => [d.code, d.line])).toEqual([
            ['gen.statement-unsupported', 2],
            ['gen.statement-unsupported', 4],
        ]);
        expect(children.map(c => c.text)).toEqual(['- [ ] 子']);
    });

    it('reports diagnostics in line order', () => {
        expect(codes([
            '  - [ ] 端数',
            '- [ ] 親',
        ])).toEqual([['gen.ragged-indent', 1], ['gen.root-not-first', 2]]);
    });
});
