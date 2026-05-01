import { describe, it, expect, vi } from 'vitest';
import { TaskWriteService } from '../../../src/services/data/TaskWriteService';
import { makeTask } from '../helpers/makeTask';
import type { Task, ChildLine } from '../../../src/types';

const plainCl = (text: string, checkboxChar: string | null = null): ChildLine => ({
    text,
    indent: '',
    checkboxChar,
    wikilinkTarget: null,
    propertyKey: null,
    propertyValue: null,
});

function buildIndex(tasks: Task[]) {
    const map = new Map(tasks.map(t => [t.id, t]));
    return {
        getTask: (id: string) => map.get(id),
        updateLine: vi.fn(async () => {}),
        insertLineAfterLine: vi.fn(async () => {}),
        deleteLine: vi.fn(async () => {}),
    } as any;
}

describe('TaskWriteService child-line operations', () => {
    it('updateChildLine writes through when bodyLine matches a plain entry', async () => {
        const parent = makeTask({
            id: 'p',
            file: 'note.md',
            parserId: 'tv-inline',
            line: 5,
            childLines: [plainCl('- [ ] x', ' ')],
            childLineBodyOffsets: [6],
        });
        const idx = buildIndex([parent]);
        const svc = new TaskWriteService(idx);

        await svc.updateChildLine('p', 6, '- [x] x');
        expect(idx.updateLine).toHaveBeenCalledWith('note.md', 6, '- [x] x');
    });

    it('updateChildLine throws when parent is missing', async () => {
        const idx = buildIndex([]);
        const svc = new TaskWriteService(idx);
        await expect(svc.updateChildLine('missing', 6, 'x')).rejects.toThrow(/parent task not found/);
        expect(idx.updateLine).not.toHaveBeenCalled();
    });

    it('updateChildLine throws when bodyLine is not a child of parent', async () => {
        const parent = makeTask({
            id: 'p',
            parserId: 'tv-inline',
            line: 5,
            childLines: [plainCl('- a', ' ')],
            childLineBodyOffsets: [6],
        });
        const idx = buildIndex([parent]);
        const svc = new TaskWriteService(idx);
        await expect(svc.updateChildLine('p', 99, 'x')).rejects.toThrow(/not a child entry/);
        expect(idx.updateLine).not.toHaveBeenCalled();
    });

    it('updateChildLine throws when bodyLine belongs to a child task', async () => {
        const parent = makeTask({
            id: 'p',
            file: 'f.md',
            parserId: 'tv-inline',
            line: 5,
            childIds: ['c'],
            childLines: [],
            childLineBodyOffsets: [],
        });
        const child = makeTask({ id: 'c', file: 'f.md', parserId: 'tv-inline', line: 6 });
        const idx = buildIndex([parent, child]);
        const svc = new TaskWriteService(idx);
        await expect(svc.updateChildLine('p', 6, 'x')).rejects.toThrow(/belongs to a child task/);
        expect(idx.updateLine).not.toHaveBeenCalled();
    });

    it('deleteChildLine writes through when bodyLine matches', async () => {
        const parent = makeTask({
            id: 'p',
            parserId: 'tv-inline',
            line: 5,
            childLines: [plainCl('- a', ' ')],
            childLineBodyOffsets: [6],
        });
        const idx = buildIndex([parent]);
        const svc = new TaskWriteService(idx);
        await svc.deleteChildLine('p', 6);
        expect(idx.deleteLine).toHaveBeenCalledWith('note.md', 6);
    });

    it('insertChildLineAfter writes through when bodyLine matches', async () => {
        const parent = makeTask({
            id: 'p',
            parserId: 'tv-inline',
            line: 5,
            childLines: [plainCl('- a', ' ')],
            childLineBodyOffsets: [6],
        });
        const idx = buildIndex([parent]);
        const svc = new TaskWriteService(idx);
        await svc.insertChildLineAfter('p', 6, '- new');
        expect(idx.insertLineAfterLine).toHaveBeenCalledWith('note.md', 6, '- new');
    });
});
