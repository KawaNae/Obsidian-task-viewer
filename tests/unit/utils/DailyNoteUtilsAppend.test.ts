import { describe, it, expect, vi, afterEach } from 'vitest';
import { TFile } from 'obsidian';
import { DailyNoteUtils } from '../../../src/utils/DailyNoteUtils';
import { HeadingInserter } from '../../../src/utils/HeadingInserter';

/**
 * appendLineToDailyNote が createDailyNote 直後の TFile を writeUnderHeading に
 * どう渡すかを pin する。file.path へ変換して渡すと、作成直後のファイルが
 * vault index からパスで引き直せない実装（Obsidian バージョン依存）で
 * 書き込みが黙って失敗しうる — レビューで指摘された退行の再発防止。
 */
describe('DailyNoteUtils.appendLineToDailyNote', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('passes the freshly created TFile object directly to writeUnderHeading, not a re-resolved path', async () => {
        const created = new TFile();
        const app = {
            internalPlugins: { getPluginById: () => null }, // → getDailyNoteSettings のデフォルトへフォールバック
            vault: {
                getAbstractFileByPath: () => null, // ノートはまだ存在しない
                adapter: { exists: vi.fn().mockResolvedValue(true) },
                createFolder: vi.fn(),
                create: vi.fn().mockResolvedValue(created),
            },
        } as any;

        const spy = vi.spyOn(HeadingInserter, 'writeUnderHeading').mockResolvedValue(1);

        const path = await DailyNoteUtils.appendLineToDailyNote(app, new Date(), '- [ ] task', 'Log', 2);

        expect(spy).toHaveBeenCalledTimes(1);
        const fileArg = spy.mock.calls[0][1];
        expect(fileArg).toBe(created); // path 文字列ではなく TFile そのもの
        expect(path).toBe(created.path);
    });
});
