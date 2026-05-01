import { describe, it, expect } from 'vitest';
import { ChildLineResolver } from '../../../src/views/taskcard/ChildLineResolver';
import { makeTask } from '../helpers/makeTask';

describe('ChildLineResolver.resolveChildAbsoluteLine', () => {
    it('returns the absolute line stored in childLineBodyOffsets for inline tasks', () => {
        const task = makeTask({
            parserId: 'tv-inline',
            line: 10,
            childLineBodyOffsets: [11, 13],
            childLines: [
                { text: '- key:: v', indent: '\t', checkboxChar: null, wikilinkTarget: null, propertyKey: 'key', propertyValue: 'v' },
                { text: '- [ ] x', indent: '\t', checkboxChar: ' ', wikilinkTarget: null, propertyKey: null, propertyValue: null },
            ] as any,
        });
        expect(ChildLineResolver.resolveChildAbsoluteLine(task, 0)).toBe(11);
        expect(ChildLineResolver.resolveChildAbsoluteLine(task, 1)).toBe(13);
    });

    it('returns the absolute line stored in childLineBodyOffsets for frontmatter tasks', () => {
        const task = makeTask({
            parserId: 'tv-file',
            line: -1,
            childLineBodyOffsets: [5, 6, 7, 10],
            childLines: [
                { text: '- a', indent: '', checkboxChar: ' ', wikilinkTarget: null, propertyKey: null, propertyValue: null },
                { text: '- b', indent: '', checkboxChar: ' ', wikilinkTarget: null, propertyKey: null, propertyValue: null },
                { text: '- c', indent: '', checkboxChar: ' ', wikilinkTarget: null, propertyKey: null, propertyValue: null },
                { text: '- d', indent: '', checkboxChar: ' ', wikilinkTarget: null, propertyKey: null, propertyValue: null },
            ] as any,
        });
        expect(ChildLineResolver.resolveChildAbsoluteLine(task, 0)).toBe(5);
        expect(ChildLineResolver.resolveChildAbsoluteLine(task, 3)).toBe(10);
    });

    it('does not double-count the frontmatter end line (regression for ChildLineUtils bug)', () => {
        const task = makeTask({
            parserId: 'tv-file',
            line: -1,
            childLineBodyOffsets: [5],
            childLines: [
                { text: '- a', indent: '', checkboxChar: ' ', wikilinkTarget: null, propertyKey: null, propertyValue: null },
            ] as any,
        });
        expect(ChildLineResolver.resolveChildAbsoluteLine(task, 0)).toBe(5);
    });

    it('falls back to task.line + 1 + index for inline tasks when offset is missing', () => {
        const task = makeTask({
            parserId: 'tv-inline',
            line: 7,
            childLineBodyOffsets: [],
            childLines: [
                { text: '- a', indent: '\t', checkboxChar: null, wikilinkTarget: null, propertyKey: null, propertyValue: null },
                { text: '- b', indent: '\t', checkboxChar: null, wikilinkTarget: null, propertyKey: null, propertyValue: null },
            ] as any,
        });
        expect(ChildLineResolver.resolveChildAbsoluteLine(task, 0)).toBe(8);
        expect(ChildLineResolver.resolveChildAbsoluteLine(task, 1)).toBe(9);
    });

    it('returns -1 for frontmatter tasks when offset is missing (no fallback line available)', () => {
        const task = makeTask({
            parserId: 'tv-file',
            line: -1,
            childLineBodyOffsets: [],
            childLines: [
                { text: '- a', indent: '', checkboxChar: ' ', wikilinkTarget: null, propertyKey: null, propertyValue: null },
            ] as any,
        });
        expect(ChildLineResolver.resolveChildAbsoluteLine(task, 0)).toBe(-1);
    });
});
