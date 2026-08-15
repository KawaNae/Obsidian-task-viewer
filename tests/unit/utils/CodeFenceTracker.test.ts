import { describe, it, expect } from 'vitest';
import { CodeFenceTracker } from '../../../src/utils/CodeFenceTracker';

describe('CodeFenceTracker.mask', () => {
    it('marks the delimiters and everything between them', () => {
        expect(CodeFenceTracker.mask([
            'prose',
            '```',
            'code',
            '```',
            'prose',
        ])).toEqual([false, true, true, true, false]);
    });

    it('accepts up to 3 leading spaces (CommonMark)', () => {
        expect(CodeFenceTracker.mask(['   ```', 'code', '   ```'])).toEqual([true, true, true]);
    });

    it('does not open on a 4-space indent (that is an indented code block)', () => {
        expect(CodeFenceTracker.mask(['    ```', 'code'])).toEqual([false, false]);
    });

    it('closes only on the same char with at least the same length', () => {
        expect(CodeFenceTracker.mask([
            '````',
            '```',      // shorter: still inside
            'code',
            '````',
        ])).toEqual([true, true, true, true]);
    });

    it('rejects a backtick fence whose info string contains a backtick', () => {
        expect(CodeFenceTracker.mask(['``` a`b', 'prose'])).toEqual([false, false]);
    });

    it('handles tilde fences', () => {
        expect(CodeFenceTracker.mask(['~~~', 'code', '~~~', 'prose']))
            .toEqual([true, true, true, false]);
    });
});

describe('CodeFenceTracker.subtreeMask', () => {
    it('sees a fence indented under a list item', () => {
        expect(CodeFenceTracker.subtreeMask([
            '    ```markdown',
            '    - [ ] fenced',
            '    ```',
        ])).toEqual([true, true, true]);
    });
});

describe('CodeFenceTracker.scan', () => {
    it('reports the opening line, the closing line and the info string', () => {
        const { opens } = CodeFenceTracker.scan([
            'prose',
            '```tv-gen 週報の手順',
            '- [ ] 資料集め',
            '```',
        ]);
        expect(opens).toEqual([{ line: 1, close: 3, info: 'tv-gen 週報の手順' }]);
    });

    it('trims the info string', () => {
        expect(CodeFenceTracker.scan(['```  tv-gen  週報  ', 'x', '```']).opens[0].info)
            .toBe('tv-gen  週報');
    });

    it('reports an empty info string when there is none', () => {
        expect(CodeFenceTracker.scan(['```', 'x', '```']).opens[0].info).toBe('');
    });

    it('does NOT report a delimiter quoted inside a wider fence', () => {
        // The shape every note explaining the notation has: an outer fence
        // wrapping a sample that itself contains a fence.
        const { opens } = CodeFenceTracker.scan([
            '`````markdown',
            '```tv-gen 週報の手順',
            '- [ ] 資料集め',
            '```',
            '`````',
        ]);
        expect(opens).toEqual([{ line: 0, close: 4, info: 'markdown' }]);
    });

    it('reports close as null when the fence never closes', () => {
        const { opens, fenced } = CodeFenceTracker.scan([
            'prose',
            '```tv-gen 週報',
            '- [ ] 資料集め',
        ]);
        expect(opens).toEqual([{ line: 1, close: null, info: 'tv-gen 週報' }]);
        // Everything after an unterminated opener is fence content.
        expect(fenced).toEqual([false, true, true]);
    });

    it('reports several blocks in document order', () => {
        const { opens } = CodeFenceTracker.scan([
            '```tv-gen 朝',
            '- [ ] ストレッチ',
            '```',
            'prose',
            '~~~tv-gen 夜',
            '- [ ] 片付け',
            '~~~',
        ]);
        expect(opens.map(o => [o.line, o.close, o.info]))
            .toEqual([[0, 2, 'tv-gen 朝'], [4, 6, 'tv-gen 夜']]);
    });

    it('reports no opener for an indented block (document-level reading)', () => {
        expect(CodeFenceTracker.scan([
            '- [ ] task',
            '    ```tv-gen 手順',
            '    - [ ] a',
            '    ```',
        ]).opens).toEqual([]);
    });

    it('is the source of mask: fenced matches mask exactly', () => {
        const lines = ['a', '```x', 'b', '```', 'c', '~~~', 'd'];
        expect(CodeFenceTracker.scan(lines).fenced).toEqual(CodeFenceTracker.mask(lines));
    });
});
