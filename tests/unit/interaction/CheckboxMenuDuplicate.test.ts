import { describe, it, expect } from 'vitest';
import { CheckboxMenuBuilder, type CheckboxLineOps } from '../../../src/interaction/menu/builders/CheckboxMenuBuilder';
import { DEFAULT_SETTINGS } from '../../../src/types';
import { t } from '../../../src/i18n';

/**
 * The editor's checkbox menu duplicates a line without its `^id`, as every
 * other duplicate does (the names and IDs decision, 2026-09-25): two lines
 * with one `^id` would anchor neither, and the original would lose the ID the
 * API gives it as `path#^id`.
 */

/** A menu that keeps each item's title and click. */
function recordingMenu() {
    const clicks = new Map<string, () => unknown>();
    const menu = {
        addItem(build: (item: unknown) => void) {
            let title = '';
            const item = {
                setTitle(value: string) { title = value; return item; },
                setIcon() { return item; },
                setWarning() { return item; },
                setChecked() { return item; },
                setSubmenu() { return item; },
                onClick(fn: () => unknown) { clicks.set(title, fn); return item; },
            };
            build(item);
            return menu;
        },
        addSeparator() { return menu; },
        close() { },
    };
    return { menu, clicks };
}

async function duplicate(line: string): Promise<string[]> {
    const inserted: string[] = [];
    const ops: CheckboxLineOps = {
        updateLine: async () => true,
        insertLineAfter: async (content) => { inserted.push(content); return true; },
        deleteLine: async () => true,
    };
    const { menu, clicks } = recordingMenu();
    const builder = new CheckboxMenuBuilder({} as never, () => 0);
    expect(builder.addFullMenu(menu as never, line, { ...DEFAULT_SETTINGS, enableStatusMenu: false }, ops)).toBe(true);
    await clicks.get(t('menu.duplicate'))!();
    return inserted;
}

describe('the editor checkbox menu\'s duplicate', () => {
    it('writes the line again without its ^id', async () => {
        expect(await duplicate('    - [ ] 買い物 ^shop')).toEqual(['    - [ ] 買い物']);
    });

    it('writes a line with no ^id as it is', async () => {
        expect(await duplicate('- [x] 買い物 #tag')).toEqual(['- [x] 買い物 #tag']);
    });
});
