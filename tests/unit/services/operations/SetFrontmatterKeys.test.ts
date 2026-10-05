import { describe, it, expect, vi } from 'vitest';
import { Operations } from '../../../../src/services/operations/Operations';

const proto = Operations.prototype as unknown as {
    setFrontmatterKeys(this: unknown, path: string, updates: Record<string, string | null>): Promise<boolean>;
    refuseAfterDispose: unknown;
};

/**
 * WindowAttachment / PropertyValueSuggest が
 * Repository を直接呼ばず Operations 経由に揃えたことの配線を pin する。
 * 実装は TaskRepository/FrontmatterWriter のままで、行を持たない書き込みで
 * あることだけを確認する。
 */
describe('Operations.setFrontmatterKeys', () => {
    function host(disposed: boolean) {
        const setFrontmatterKeys = vi.fn().mockResolvedValue({ written: true, refused: null, made: [], rows: [] });
        return { setFrontmatterKeys, self: { disposed, refuseAfterDispose: proto.refuseAfterDispose, repository: { setFrontmatterKeys } } };
    }

    it('writes the keys through the repository unchanged, and answers whether it wrote', async () => {
        const { setFrontmatterKeys, self } = host(false);

        expect(await proto.setFrontmatterKeys.call(self, 'note.md', { color: 'ff0000' })).toBe(true);

        expect(setFrontmatterKeys).toHaveBeenCalledWith('note.md', { color: 'ff0000' });
        expect(setFrontmatterKeys).toHaveBeenCalledTimes(1);
    });

    it('writes nothing once the operations are taken down', async () => {
        const { setFrontmatterKeys, self } = host(true);

        expect(await proto.setFrontmatterKeys.call(self, 'note.md', { color: 'ff0000' })).toBe(false);
        expect(setFrontmatterKeys).not.toHaveBeenCalled();
    });
});
