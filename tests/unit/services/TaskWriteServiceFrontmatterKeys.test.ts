import { describe, it, expect, vi } from 'vitest';
import { TaskWriteService } from '../../../src/services/data/TaskWriteService';
import type { TaskIndex } from '../../../src/services/core/TaskIndex';

/**
 * WindowAttachment / PropertyColorSuggest / PropertyLineStyleSuggest /
 * TimerTargetManager が Repository を直接呼ばず TaskWriteService 経由に
 * 揃えたことの配線を pin する。実装は TaskRepository/FrontmatterWriter の
 * ままで、素通しであることだけを確認する。
 */
describe('TaskWriteService frontmatter-key passthroughs', () => {
    it('setFrontmatterKeys delegates to repository.setFrontmatterKeys unchanged', async () => {
        const setFrontmatterKeys = vi.fn().mockResolvedValue({ written: true, refused: null, made: [], rows: [] });
        const taskIndex = {
            getRepository: () => ({ setFrontmatterKeys }),
        } as unknown as TaskIndex;
        const service = new TaskWriteService(taskIndex);

        expect(await service.setFrontmatterKeys('note.md', { color: 'ff0000' })).toBe(true);

        expect(setFrontmatterKeys).toHaveBeenCalledWith('note.md', { color: 'ff0000' });
        expect(setFrontmatterKeys).toHaveBeenCalledTimes(1);
    });
});
