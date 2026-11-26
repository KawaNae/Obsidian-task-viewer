import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { FocusDoc, FocusEl, asEl } from '../helpers/focusDom';
import type { SettingFields } from '../../../src/settings/SettingFields';
import { SETTINGS_SCHEMA } from '../../../src/settings/SettingsSchema';

/**
 * The plugin's settings tab, in a stand-in DOM (`focusDom`), its tabs' own
 * settings stood in for: the row of tabs and a pane for each are the
 * strip's (`TabStrip`), nine named tabs with no icons. The tab last chosen
 * is the one the settings open on again, and the one a tab's drawing
 * anew keeps. What is typed in a field is committed once as another tab is
 * chosen, before its pane is marked off, and not again as the settings close.
 */

const stand = vi.hoisted(() => ({
    settings: { startHour: 5 },
    /** The basic tab's field, as drawn last. */
    input: null as unknown,
    /** Whether the basic pane was off (`inert`) as the hour was put. */
    inertAtPut: [] as boolean[],
}));

vi.mock('../../../src/settings/BasicTab', () => ({
    render: (el: HTMLElement, _plugin: unknown, fields: SettingFields) => {
        const pane = el as unknown as FocusEl;
        const setting = {
            descEl: pane.createDiv(),
            addText(cb: (text: unknown) => void) {
                const input = pane.createEl('input');
                stand.input = input;
                cb({ inputEl: input, setPlaceholder: () => undefined });
                return this;
            },
        };
        fields.text(setting as never, {
            codec: SETTINGS_SCHEMA.startHour.codec,
            get: () => stand.settings.startHour,
            put: (hour: number) => {
                stand.inertAtPut.push(pane.attrs.has('inert'));
                stand.settings.startHour = hour;
            },
        });
    },
}));
for (const tab of ['GeneralTab', 'ViewsTab', 'ViewDetailsTab', 'NotesTab', 'FrontmatterTab', 'ParsersTab', 'LogTab', 'AboutTab']) {
    vi.doMock(`../../../src/settings/${tab}`, () => ({ render: () => undefined }));
}

const { TaskViewerSettingTab } = await import('../../../src/settings/index');

const IDS = ['basic', 'general', 'views', 'viewDetails', 'notes', 'frontmatter', 'parsers', 'log', 'about'];

function setUp() {
    const doc = new FocusDoc();
    const root = doc.root();
    const saveSettings = vi.fn().mockResolvedValue(undefined);
    const plugin = { manifest: { version: '1.0.0' }, saveSettings };
    const tab = new TaskViewerSettingTab({} as never, plugin as never);
    tab.containerEl = asEl(root);
    const buttons = () => root.findAll('tv-tabs__tab');
    const button = (id: string) => buttons().find(b => b.attrs.get('data-tab') === id)!;
    const chosen = () => buttons().filter(b => b.attrs.get('aria-selected') === 'true').map(b => b.attrs.get('data-tab'));
    const pane = (id: string) => root.findAll('tv-tabs__pane')[IDS.indexOf(id)];
    const click = (id: string) => button(id).dispatchEvent(new Event('click'));
    return { doc, root, tab, saveSettings, buttons, button, chosen, pane, click };
}

beforeEach(() => {
    stand.settings.startHour = 5;
    stand.inertAtPut.length = 0;
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('the settings tab', () => {
    it('lays its nine tabs in the strip, each a named button with no icon, over a pane of its own', () => {
        const s = setUp();
        s.tab.display();
        expect(s.root.children.slice(1)).toEqual([s.root.find('tv-tabs'), s.root.find('tv-tabs__panes')]);
        expect(s.buttons().map(b => b.attrs.get('data-tab'))).toEqual(IDS);
        expect(s.buttons().every(b => b.find('tv-tabs__label')?.text)).toBe(true);
        expect(s.root.findAll('tv-tabs__icon')).toHaveLength(0);
        expect(s.root.findAll('tv-tabs__pane')).toHaveLength(9);
        expect(s.chosen()).toEqual(['basic']);
    });

    it('opens again on the tab chosen last, and keeps it as it is drawn anew', () => {
        const s = setUp();
        s.tab.display();
        s.click('notes');
        s.tab.display();
        expect(s.chosen()).toEqual(['notes']);
        expect(s.pane('notes').attrs.has('inert')).toBe(false);
        expect(s.pane('basic').attrs.has('inert')).toBe(true);
        s.tab.hide();
        s.tab.display();
        expect(s.chosen()).toEqual(['notes']);
    });

    it.each([
        ['the button taking the focus as it is pressed', true],
        ['the focus left in the field as the button is pressed', false],
    ])('commits what is typed once as another tab is chosen, %s, before the pane is marked off', async (_name, pressFocuses) => {
        const s = setUp();
        s.tab.display();
        const input = stand.input as FocusEl;
        input.focus();
        input.type('7');
        if (pressFocuses) s.button('general').focus();
        s.click('general');
        expect(stand.settings.startHour).toBe(7);
        expect(stand.inertAtPut).toEqual([false]);
        expect(s.doc.activeElement).toBe(s.button('general'));
        expect(s.pane('basic').attrs.has('inert')).toBe(true);
        await Promise.resolve();
        s.tab.hide();
        expect(s.saveSettings).toHaveBeenCalledTimes(1);
    });

    it('commits what is typed as the settings close', () => {
        const s = setUp();
        s.tab.display();
        const input = stand.input as FocusEl;
        input.focus();
        input.type('8');
        s.tab.hide();
        expect(stand.settings.startHour).toBe(8);
        expect(s.saveSettings).toHaveBeenCalledTimes(1);
    });

    it('opens again with the tab chosen last scrolled into its row, as the row is narrower than its tabs', () => {
        // A row 300px wide over tabs 100px wide each, in a row scrolled by its scrollLeft.
        vi.spyOn(FocusEl.prototype, 'getBoundingClientRect').mockImplementation(function (this: FocusEl) {
            if (this.classes.has('tv-tabs')) return { left: 0, right: 300, top: 0, bottom: 40 };
            if (this.classes.has('tv-tabs__tab')) {
                const left = IDS.indexOf(this.attrs.get('data-tab')!) * 100 - this.parent!.scrollLeft;
                return { left, right: left + 100, top: 0, bottom: 40 };
            }
            return { left: 0, right: 0, top: 0, bottom: 0 };
        });
        const s = setUp();
        s.tab.display();
        const row = () => s.root.find('tv-tabs')!;
        expect(row().scrollLeft).toBe(0);
        s.click('about');
        expect(row().scrollLeft).toBe(600);
        s.tab.hide();
        s.tab.display();
        expect(row().scrollLeft).toBe(600);
        s.click('views');
        expect(row().scrollLeft).toBe(200);
    });
});
