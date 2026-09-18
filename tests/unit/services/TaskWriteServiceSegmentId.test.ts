import { describe, it, expect, vi } from 'vitest';
import { TaskWriteService } from '../../../src/services/data/TaskWriteService';
import type { Task } from '../../../src/types';

function buildIndex() {
    return {
        getTask: () => undefined,
        updateTask: vi.fn(async () => {}),
    } as any;
}

describe('TaskWriteService synthetic segment ID resolution', () => {
    // 不変条件: 表示層の合成 ID（…##seg:YYYY-MM-DD）は write 層の入口で
    // 原タスク ID に解決され、TaskIndex には決して届かない。

    it('updateTask resolves a segment ID before delegating to TaskIndex', async () => {
        const idx = buildIndex();
        const svc = new TaskWriteService(idx);

        await svc.updateTask('tv-inline:note.md:ln:5##seg:2026-07-24', { status: 'x' } as Partial<Task>);
        expect(idx.updateTask).toHaveBeenCalledWith('tv-inline:note.md:ln:5', { status: 'x' });
    });

    it('non-segment IDs pass through unchanged', async () => {
        const idx = buildIndex();
        const svc = new TaskWriteService(idx);

        await svc.updateTask('tv-inline:note.md:ln:5', {});
        expect(idx.updateTask).toHaveBeenCalledWith('tv-inline:note.md:ln:5', {});
    });
});
