import { describe, it, expect, vi } from 'vitest';
import { PropertyColorSuggest } from '../../../src/suggest/color/PropertyColorSuggest';
import { PropertyLineStyleSuggest } from '../../../src/suggest/line/PropertyLineStyleSuggest';

/**
 * The Properties View suggests write the chosen value to the frontmatter, and
 * show it in the field only when it was written. A value the write refused is
 * not in the file; showing it would say it is. (The reason is told by the
 * write layer.)
 *
 * The suggest's DOM (AbstractInputSuggest) is not built here: an instance is
 * made from the prototype with only what `updateFrontmatter` reads.
 */

type Suggest = typeof PropertyColorSuggest | typeof PropertyLineStyleSuggest;

function suggestAnswering(Cls: Suggest, written: boolean, activeFile: { path: string } | null = { path: 'note.md' }) {
    const setFrontmatterKeys = vi.fn(async () => written);
    const syncValue = vi.fn();
    const suggest = Object.create(Cls.prototype) as Record<string, unknown>;
    Object.assign(suggest, {
        plugin: {
            app: { workspace: { getActiveFile: () => activeFile } },
            settings: { scopeKeys: { color: 'tv-color', linestyle: 'tv-linestyle' } },
            getTaskWriteService: () => ({ setFrontmatterKeys }),
        },
        syncValue,
    });
    const update = (value: string) =>
        (suggest as unknown as { updateFrontmatter(v: string): Promise<void> }).updateFrontmatter(value);
    return { update, setFrontmatterKeys, syncValue };
}

describe.each([
    ['PropertyColorSuggest', PropertyColorSuggest, 'tv-color', 'red'],
    ['PropertyLineStyleSuggest', PropertyLineStyleSuggest, 'tv-linestyle', 'dashed'],
] as const)('%s.updateFrontmatter', (_name, Cls, key, value) => {
    it('does not show the value when the write was not made', async () => {
        const h = suggestAnswering(Cls, false);

        await h.update(value);

        expect(h.setFrontmatterKeys).toHaveBeenCalledWith('note.md', { [key]: value });
        expect(h.syncValue).not.toHaveBeenCalled();
    });

    it('shows the value when the write was made', async () => {
        const h = suggestAnswering(Cls, true);

        await h.update(value);

        expect(h.setFrontmatterKeys).toHaveBeenCalledTimes(1);
        expect(h.syncValue).toHaveBeenCalledWith(value);
    });

    it('shows the value without writing when no file is open', async () => {
        const h = suggestAnswering(Cls, false, null);

        await h.update(value);

        expect(h.setFrontmatterKeys).not.toHaveBeenCalled();
        expect(h.syncValue).toHaveBeenCalledWith(value);
    });
});
