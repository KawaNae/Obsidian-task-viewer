import { describe, it, expect } from 'vitest';
import { collectGenBlocks } from '../../../src/services/parsing/gen/GenBlockCollector';

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
