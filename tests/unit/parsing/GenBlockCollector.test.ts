import { describe, it, expect } from 'vitest';
import {
    collectGenBlocks,
    type LocatedDiagnostic,
    spreadOverLines,
} from '../../../src/services/parsing/gen/GenBlockCollector';

const codes = (lines: string[]) =>
    collectGenBlocks(lines).diagnostics.map(d => [d.code, d.line]);

describe('collectGenBlocks', () => {
    it('collects a named block with its body verbatim', () => {
        const { blocks, diagnostics } = collectGenBlocks([
            '- [ ] 週報 @2026-08-17 ==> every mon use("週報の手順")',
            '',
            '```tv-gen 週報の手順',
            '- [ ] 資料集め',
            '    - [ ] 下書き',
            '```',
        ]);
        expect(diagnostics).toEqual([]);
        expect(blocks.get('週報の手順')).toEqual({
            name: '週報の手順',
            body: ['- [ ] 資料集め', '    - [ ] 下書き'],
            openLine: 2,
            closeLine: 5,
        });
    });

    it('keeps a name that contains spaces', () => {
        const { blocks } = collectGenBlocks(['```tv-gen 週次 レビュー', 'x', '```']);
        expect([...blocks.keys()]).toEqual(['週次 レビュー']);
    });

    it('collects several blocks', () => {
        const { blocks } = collectGenBlocks([
            '```tv-gen 朝', '- [ ] ストレッチ', '```',
            'prose',
            '~~~tv-gen 夜', '- [ ] 片付け', '~~~',
        ]);
        expect([...blocks.keys()]).toEqual(['朝', '夜']);
        expect(blocks.get('夜')!.body).toEqual(['- [ ] 片付け']);
    });

    it('keeps an empty body as an empty array', () => {
        const { blocks } = collectGenBlocks(['```tv-gen 空', '```']);
        expect(blocks.get('空')!.body).toEqual([]);
    });

    describe('the samples of a note explaining the notation stay quiet', () => {
        it('does not collect a block quoted inside a wider fence', () => {
            const { blocks, diagnostics } = collectGenBlocks([
                '`````markdown',
                '```tv-gen 週報の手順',
                '- [ ] 資料集め',
                '```',
                '`````',
            ]);
            expect(blocks.size).toBe(0);
            expect(diagnostics).toEqual([]);
        });

        it('does not warn about an indented sample inside a wider fence', () => {
            expect(codes([
                '`````markdown',
                '- [ ] task',
                '    ```tv-gen 手順',
                '    - [ ] a',
                '    ```',
                '`````',
            ])).toEqual([]);
        });
    });

    describe('diagnostics', () => {
        it('reports a block with no name', () => {
            expect(codes(['```tv-gen', '- [ ] a', '```'])).toEqual([['gen.missing-name', 0]]);
        });

        it('reports a duplicate name on the later block', () => {
            const { blocks, diagnostics } = collectGenBlocks([
                '```tv-gen 手順', '- [ ] 先', '```',
                '```tv-gen 手順', '- [ ] 後', '```',
            ]);
            expect(diagnostics.map(d => [d.code, d.line])).toEqual([['gen.duplicate-name', 3]]);
            expect(blocks.get('手順')!.body).toEqual(['- [ ] 先']);
        });

        it('reports a block that is never closed', () => {
            expect(codes(['prose', '```tv-gen 手順', '- [ ] a'])).toEqual([
                ['gen.unterminated-block', 1],
            ]);
        });

        it('reports an indented block and does not collect it', () => {
            const { blocks, diagnostics } = collectGenBlocks([
                '- [ ] task',
                '    ```tv-gen 手順',
                '    - [ ] a',
                '    ```',
            ]);
            expect(blocks.size).toBe(0);
            expect(diagnostics.map(d => [d.code, d.line])).toEqual([['gen.indented-block', 1]]);
            // The span skips the indentation and covers the delimiter line.
            expect(diagnostics[0].span).toEqual({ start: 4, end: 16 });
        });

        it('reports a mistyped tv- tag', () => {
            const { diagnostics } = collectGenBlocks(['```tv-gne 手順', 'x', '```']);
            expect(diagnostics.map(d => [d.code, d.params])).toEqual([
                ['gen.unknown-tag', { tag: 'tv-gne' }],
            ]);
        });

        it('says nothing about other languages', () => {
            expect(codes(['```js', 'const a = 1', '```', '```', 'x', '```'])).toEqual([]);
        });

        it('reports diagnostics in line order', () => {
            expect(codes([
                '- [ ] task',
                '    ```tv-gen 字下げ',
                '    ```',
                '```tv-gen',
                '```',
            ])).toEqual([['gen.indented-block', 1], ['gen.missing-name', 3]]);
        });
    });
});

// 装飾は 1 行の範囲でしかない。行をまたぐ span を持てるのは js セクションが
// 初めてなので、描く直前に行ごとへ切る。
describe('spreadOverLines', () => {
    const at = (line: number, start: number, end: number, endLine?: number): LocatedDiagnostic => ({
        severity: 'error', code: 'x.y', message: 'm', line, endLine, span: { start, end },
    });
    const lengths = (line: number) => [10, 20, 30, 40][line] ?? 0;

    it('leaves a diagnostic that fits one line alone', () => {
        const one = at(1, 2, 5);
        expect(spreadOverLines(one, lengths)).toEqual([one]);
    });

    it('cuts a two-line span at the line break', () => {
        expect(spreadOverLines(at(1, 4, 7, 2), lengths).map(p => [p.line, p.span.start, p.span.end]))
            .toEqual([[1, 4, 20], [2, 0, 7]]);
    });

    it('gives a line in the middle the whole of itself', () => {
        expect(spreadOverLines(at(1, 4, 7, 3), lengths).map(p => [p.line, p.span.start, p.span.end]))
            .toEqual([[1, 4, 20], [2, 0, 30], [3, 0, 7]]);
    });

    it('keeps the message on every piece, so any line can be hovered', () => {
        const pieces = spreadOverLines(at(1, 4, 7, 3), lengths);
        expect(pieces.map(p => [p.code, p.severity])).toEqual([
            ['x.y', 'error'], ['x.y', 'error'], ['x.y', 'error'],
        ]);
    });

    // 各ピースは自分の行だけを指す。開始行がビューポートの外へ出ても継続行の
    // 下線が残るのは、ピースが別の行を参照しないから。
    it('leaves no piece pointing at another line', () => {
        for (const piece of spreadOverLines(at(1, 4, 7, 3), lengths)) {
            expect(piece.endLine).toBeUndefined();
        }
    });
});
