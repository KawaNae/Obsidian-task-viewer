import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Text } from '@codemirror/state';
import { fenceMaskFor, fenceScanFor } from '../../../src/editor/EditorFenceCache';
import { CodeFenceTracker } from '../../../src/utils/CodeFenceTracker';

/** Minimal CM6 Text stand-in: only `.lines` and `.line(n).text` are read. */
function fakeText(lines: string[]): Text {
    return {
        lines: lines.length,
        line: (n: number) => ({ text: lines[n - 1] }),
    } as unknown as Text;
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('fenceMaskFor', () => {
    it('marks a plain document-level fence', () => {
        const doc = fakeText(['prose', '```', 'code', '```', 'prose']);
        expect(fenceMaskFor(doc)).toEqual([false, true, true, true, false]);
    });

    it('marks a fence nested under a task (subtree/indented reading)', () => {
        // CommonMark's plain reading measures the fence's leading-space
        // allowance from column 0, so a fence indented under a task's child
        // content is invisible to it alone — this is exactly the case the
        // subtreeMask OR exists for.
        const doc = fakeText([
            '- [ ] task',
            '    ```',
            '    - [ ] fenced checkbox, not a real task',
            '    ```',
        ]);
        expect(fenceMaskFor(doc)).toEqual([false, true, true, true]);
    });

    it('is false for an ordinary task line outside any fence', () => {
        const doc = fakeText(['- [ ] real task', 'prose']);
        expect(fenceMaskFor(doc)).toEqual([false, false]);
    });

    it('caches per Text identity: a second call with the same doc does not rescan', () => {
        // subtreeMask delegates to scan() internally (on the dedented
        // lines), so one fresh analysis is 2 scan() calls — both must stay
        // flat across repeat calls with the same doc, not grow.
        const scanSpy = vi.spyOn(CodeFenceTracker, 'scan');
        const subtreeSpy = vi.spyOn(CodeFenceTracker, 'subtreeMask');
        const doc = fakeText(['```', 'code', '```']);

        fenceMaskFor(doc);
        const scanCallsAfterFirst = scanSpy.mock.calls.length;
        expect(subtreeSpy).toHaveBeenCalledTimes(1);

        // Same Text reference again, plus the other accessor (fenceScanFor) —
        // both must read the one cached analysis, not scan again.
        fenceMaskFor(doc);
        fenceScanFor(doc);
        expect(scanSpy.mock.calls.length).toBe(scanCallsAfterFirst);
        expect(subtreeSpy).toHaveBeenCalledTimes(1);
    });

    it('recomputes for a different Text object (not globally sticky)', () => {
        const docA = fakeText(['```', 'code', '```']);
        const docB = fakeText(['prose', 'more prose']);
        expect(fenceMaskFor(docA)).toEqual([true, true, true]);
        expect(fenceMaskFor(docB)).toEqual([false, false]);
    });
});

describe('fenceScanFor', () => {
    it('exposes the opening-delimiter metadata alongside membership', () => {
        const doc = fakeText(['prose', '```tv-gen js', 'code', '```', 'prose']);
        const scan = fenceScanFor(doc);
        expect(scan.fenced).toEqual([false, true, true, true, false]);
        expect(scan.opens).toHaveLength(1);
        expect(scan.opens[0]).toMatchObject({ line: 1, info: 'tv-gen js' });
    });
});
