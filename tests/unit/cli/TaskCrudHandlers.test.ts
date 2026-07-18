import { describe, it, expect, vi } from 'vitest';
import { createCreateHandler, createUpdateHandler } from '../../../src/cli/handlers/TaskCrudHandlers';

function createMockPlugin(apiOverride: Record<string, any> = {}) {
    return {
        api: {
            create: vi.fn().mockResolvedValue({
                task: { id: 'test-1', content: 'task', status: ' ', file: 'a.md', line: 1 },
            }),
            update: vi.fn().mockResolvedValue({
                task: { id: 'test-1', content: 'task', status: ' ', file: 'a.md', line: 1 },
            }),
            ...apiOverride,
        },
    } as any;
}

describe('C9: output-fields を mutation 前に検証', () => {
    it('create: 不正な output-fields で mutation 実行前にエラー', async () => {
        const plugin = createMockPlugin();
        const handler = createCreateHandler(plugin);
        const result = await handler({ file: 'a.md', content: 'task', 'output-fields': 'nonexistent' });
        const parsed = JSON.parse(result);
        expect(parsed.error).toMatch(/Unknown field/);
        expect(plugin.api.create).not.toHaveBeenCalled();
    });

    it('update: 不正な output-fields で mutation 実行前にエラー', async () => {
        const plugin = createMockPlugin();
        const handler = createUpdateHandler(plugin);
        const result = await handler({ id: 'test-1', content: 'new', 'output-fields': 'nonexistent' });
        const parsed = JSON.parse(result);
        expect(parsed.error).toMatch(/Unknown field/);
        expect(plugin.api.update).not.toHaveBeenCalled();
    });

    it('create: 正しい output-fields は通過', async () => {
        const plugin = createMockPlugin();
        const handler = createCreateHandler(plugin);
        const result = await handler({ file: 'a.md', content: 'task', 'output-fields': 'content,status' });
        const parsed = JSON.parse(result);
        expect(parsed.error).toBeUndefined();
        expect(plugin.api.create).toHaveBeenCalled();
    });
});
