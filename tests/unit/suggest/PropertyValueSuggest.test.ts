import { describe, it, expect, vi } from 'vitest';
import { TFile } from 'obsidian';
import { PropertyValueSuggest } from '../../../src/suggest/PropertyValueSuggest';
import { COLOR_VALUES, LINE_STYLE_VALUES, type ScopeValueKind } from '../../../src/suggest/ScopeValues';

/**
 * The Properties view's suggest writes the value picked to the note of the
 * leaf the field is in — not the active note — and shows it in the field
 * only when it was written. A value the write refused is not in the file;
 * showing it would say it is. (The reason is told by the write layer.)
 *
 * The workspace is a stand-in with two leaves: the field is in the one that
 * is not active.
 */

function noteAt(path: string): TFile {
    const file = new TFile();
    file.path = path;
    return file;
}

function suggestAnswering(kind: ScopeValueKind, written: boolean, inLeaf = true) {
    const setFrontmatterKeys = vi.fn(async () => written);
    const field = { tagName: 'DIV', textContent: 'old' } as unknown as HTMLDivElement;
    const leaves = [
        { view: { file: noteAt('active.md'), containerEl: { contains: () => false } } },
        { view: { file: noteAt('beside.md'), containerEl: { contains: (el: unknown) => inLeaf && el === field } } },
    ];
    const app = {
        scope: {},
        keymap: { pushScope: () => {}, popScope: () => {} },
        workspace: {
            getActiveFile: () => leaves[0].view.file,
            iterateAllLeaves: (fn: (leaf: unknown) => void) => leaves.forEach(fn),
        },
    };
    const plugin = {
        settings: { scopeKeys: { color: 'tv-color', linestyle: 'tv-linestyle' } },
        getOperations: () => ({ setFrontmatterKeys }),
    };
    const suggest = new PropertyValueSuggest(app as never, field, plugin as never, kind);
    const pick = async (value: string) => {
        suggest.selectSuggestion(value, { type: 'click' } as MouseEvent);
        await Promise.resolve();
        await Promise.resolve();
    };
    return { pick, setFrontmatterKeys, field };
}

describe.each([
    ['color', COLOR_VALUES, 'tv-color', 'red'],
    ['line style', LINE_STYLE_VALUES, 'tv-linestyle', 'dashed'],
] as const)('PropertyValueSuggest (%s)', (_name, kind, key, value) => {
    it('writes to the note of the leaf the field is in, not the active note', async () => {
        const h = suggestAnswering(kind, true);

        await h.pick(value);

        expect(h.setFrontmatterKeys).toHaveBeenCalledWith('beside.md', { [key]: value });
        expect(h.field.textContent).toBe(value);
    });

    it('does not show the value when the write was not made', async () => {
        const h = suggestAnswering(kind, false);

        await h.pick(value);

        expect(h.setFrontmatterKeys).toHaveBeenCalledTimes(1);
        expect(h.field.textContent).toBe('old');
    });

    it('shows the value without writing when no leaf holds the field', async () => {
        const h = suggestAnswering(kind, false, false);

        await h.pick(value);

        expect(h.setFrontmatterKeys).not.toHaveBeenCalled();
        expect(h.field.textContent).toBe(value);
    });
});
