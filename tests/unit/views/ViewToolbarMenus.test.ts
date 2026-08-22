import { describe, it, expect } from 'vitest';
import {
    ViewModeSelector,
    ZoomSelector,
    appendCompactFilterAndMask,
    type CompactMenuDeps,
} from '../../../src/views/sharedUI/ViewToolbar';
import type { Menu } from 'obsidian';

/**
 * Recording stand-ins for Obsidian's Menu / MenuItem. The shared obsidian mock
 * ships a no-op Menu, and these tests need to read back what was appended, so
 * they model just enough here — the "plain object, no jsdom" pattern used in
 * tests/unit/drag/GridMoveGesture.test.ts.
 */
interface RecordedItem {
    title: string;
    icon?: string;
    checked?: boolean;
    click?: () => void;
    submenu?: RecordedMenu;
}

class RecordedMenu {
    readonly items: RecordedItem[] = [];
    separators = 0;

    addItem(cb: (item: RecordedMenuItem) => void): this {
        const rec: RecordedItem = { title: '' };
        this.items.push(rec);
        cb(new RecordedMenuItem(rec));
        return this;
    }

    addSeparator(): this {
        this.separators++;
        return this;
    }

    /** Titles of the items, in order. */
    titles(): string[] {
        return this.items.map(i => i.title);
    }

    /** Titles that were rendered with a check mark. */
    checkedTitles(): string[] {
        return this.items.filter(i => i.checked).map(i => i.title);
    }

    click(title: string): void {
        const item = this.items.find(i => i.title === title);
        if (!item?.click) throw new Error(`no clickable item titled "${title}"`);
        item.click();
    }

    /** Cast for APIs typed against Obsidian's Menu. */
    asMenu(): Menu {
        return this as unknown as Menu;
    }
}

class RecordedMenuItem {
    constructor(private rec: RecordedItem) {}
    setTitle(title: string): this { this.rec.title = title; return this; }
    setIcon(icon: string): this { this.rec.icon = icon; return this; }
    setChecked(checked: boolean): this { this.rec.checked = checked; return this; }
    setDisabled(): this { return this; }
    onClick(cb: () => void): this { this.rec.click = cb; return this; }
    setSubmenu(): RecordedMenu {
        const sub = new RecordedMenu();
        this.rec.submenu = sub;
        return sub;
    }
}

describe('ViewModeSelector menu items', () => {
    it('offers exactly the three day counts', () => {
        const menu = new RecordedMenu();
        ViewModeSelector.appendMenuItems(menu.asMenu(), () => 3, () => {});
        expect(menu.titles()).toEqual(['1 Day', '3 Days', 'Week']);
    });

    it('checks the item matching the current value', () => {
        const menu = new RecordedMenu();
        ViewModeSelector.appendMenuItems(menu.asMenu(), () => 7, () => {});
        expect(menu.checkedTitles()).toEqual(['Week']);
    });

    it('reports the picked value', () => {
        const picked: number[] = [];
        const menu = new RecordedMenu();
        ViewModeSelector.appendMenuItems(menu.asMenu(), () => 3, (v) => picked.push(v));
        menu.click('1 Day');
        menu.click('Week');
        expect(picked).toEqual([1, 7]);
    });

    it('offers the same choices from the compact submenu as from the dropdown', () => {
        // The point of the shared list: the "⋮" submenu and the toolbar button
        // cannot drift apart, in labels, order, or checked state.
        const dropdown = new RecordedMenu();
        ViewModeSelector.appendMenuItems(dropdown.asMenu(), () => 3, () => {});

        const compact = new RecordedMenu();
        ViewModeSelector.appendSubmenu(compact.asMenu(), () => 3, () => {});
        const sub = compact.items[0].submenu;

        expect(compact.items).toHaveLength(1);
        expect(compact.items[0].title).toBe('View mode: 3 Days');
        expect(sub?.titles()).toEqual(dropdown.titles());
        expect(sub?.checkedTitles()).toEqual(dropdown.checkedTitles());
    });
});

describe('ZoomSelector menu items', () => {
    it('offers exactly the seven zoom steps', () => {
        const menu = new RecordedMenu();
        ZoomSelector.appendMenuItems(menu.asMenu(), () => 1.0, () => {});
        expect(menu.titles()).toEqual(['50%', '75%', '100%', '125%', '150%', '200%', '300%']);
    });

    it('checks the step matching the current zoom', () => {
        const menu = new RecordedMenu();
        ZoomSelector.appendMenuItems(menu.asMenu(), () => 1.5, () => {});
        expect(menu.checkedTitles()).toEqual(['150%']);
    });

    it('reports the picked level', () => {
        const picked: number[] = [];
        const menu = new RecordedMenu();
        ZoomSelector.appendMenuItems(menu.asMenu(), () => 1.0, (v) => picked.push(v));
        menu.click('50%');
        menu.click('300%');
        expect(picked).toEqual([0.5, 3.0]);
    });

    it('offers the same steps from the compact submenu as from the dropdown', () => {
        const dropdown = new RecordedMenu();
        ZoomSelector.appendMenuItems(dropdown.asMenu(), () => 1.25, () => {});

        const compact = new RecordedMenu();
        ZoomSelector.appendSubmenu(compact.asMenu(), () => 1.25, () => {});
        const sub = compact.items[0].submenu;

        expect(compact.items).toHaveLength(1);
        expect(compact.items[0].title).toBe('Zoom: 125%');
        expect(sub?.titles()).toEqual(dropdown.titles());
        expect(sub?.checkedTitles()).toEqual(dropdown.checkedTitles());
    });
});

describe('appendCompactFilterAndMask', () => {
    function makeDeps(overrides: Partial<CompactMenuDeps> = {}) {
        const calls = {
            popoverAnchors: [] as unknown[],
            filterChanges: 0,
            maskWrites: [] as boolean[],
            afters: 0,
        };
        let maskMode = false;
        const deps = {
            filterMenu: {
                showMenuAtElement(anchorEl: unknown, options: { onFilterChange: () => void }) {
                    calls.popoverAnchors.push(anchorEl);
                    options.onFilterChange();
                },
            },
            getTasks: () => [],
            getStartHour: () => 4,
            onFilterChange: () => { calls.filterChanges++; },
            getMaskMode: () => maskMode,
            setMaskMode: (next: boolean) => { calls.maskWrites.push(next); maskMode = next; },
            onAfter: () => { calls.afters++; },
            ...overrides,
        } as unknown as CompactMenuDeps;
        return { deps, calls };
    }

    it('appends exactly the filter and mask entries', () => {
        const menu = new RecordedMenu();
        const { deps } = makeDeps();
        appendCompactFilterAndMask(menu.asMenu(), {} as HTMLElement, deps);
        expect(menu.titles()).toEqual(['Filter', 'Mask mode']);
    });

    it('opens the filter popover anchored to the element it was given', () => {
        const anchor = { id: 'more-btn' } as unknown as HTMLElement;
        const menu = new RecordedMenu();
        const { deps, calls } = makeDeps();
        appendCompactFilterAndMask(menu.asMenu(), anchor, deps);
        menu.click('Filter');
        expect(calls.popoverAnchors).toEqual([anchor]);
        expect(calls.filterChanges).toBe(1);
        expect(calls.afters).toBe(1);
    });

    it('toggles mask mode to the opposite of the current state', () => {
        const menu = new RecordedMenu();
        const { deps, calls } = makeDeps();
        appendCompactFilterAndMask(menu.asMenu(), {} as HTMLElement, deps);
        menu.click('Mask mode');
        expect(calls.maskWrites).toEqual([true]);
        expect(calls.afters).toBe(1);
    });

    it('renders the mask entry checked, with the eye-off icon, while mask mode is on', () => {
        const menu = new RecordedMenu();
        const { deps } = makeDeps({ getMaskMode: () => true });
        appendCompactFilterAndMask(menu.asMenu(), {} as HTMLElement, deps);
        const mask = menu.items[1];
        expect(mask.checked).toBe(true);
        expect(mask.icon).toBe('eye-off');
    });

    it('renders the mask entry unchecked, with the eye icon, while mask mode is off', () => {
        const menu = new RecordedMenu();
        const { deps } = makeDeps({ getMaskMode: () => false });
        appendCompactFilterAndMask(menu.asMenu(), {} as HTMLElement, deps);
        const mask = menu.items[1];
        expect(mask.checked).toBe(false);
        expect(mask.icon).toBe('eye');
    });
});
