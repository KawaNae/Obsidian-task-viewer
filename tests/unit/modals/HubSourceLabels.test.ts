import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { TaskHubForm } from '../../../src/modals/hub/TaskHubForm';
import type { HubHost } from '../../../src/modals/hub/HubHost';
import { FileParsePipeline } from '../../../src/services/parsing/FileParsePipeline';
import { namesOutsideIndex } from '../../../src/services/core/RowNames';
import { DEFAULT_SETTINGS } from '../../../src/types/Settings';
import type { Task } from '../../../src/types';
import { FocusDoc, FocusEl, asEl } from '../helpers/focusDom';
import { menuSpy } from '../helpers/menuSpy';

/**
 * Where the hub's fields say an inherited value comes from: the tag's chip,
 * a value field's menu (a style's, a property's), and a finding's "open the
 * line". With a host that has a row to open, each opens the line; with one
 * that has none (`HubHost.openSource` null), each is said and nothing is
 * listened for: the menus' item is greyed, and a finding offers no action.
 */

beforeAll(() => {
    vi.stubGlobal('Element', FocusEl);
    vi.stubGlobal('HTMLInputElement', class { });
    vi.stubGlobal('document', {
        createDocumentFragment: () => ({ appendChild: () => { } }),
        createElement: () => ({ style: {}, classList: { add: () => { } }, setAttribute: () => { }, appendChild: () => { } }),
    });
});
afterAll(() => { vi.unstubAllGlobals(); });

/** A row that inherits a tag and a color from the note, a line style and a property from its section, with a finding of its own. */
const ROW: Task = FileParsePipeline.parse('n.md', [
    '---',
    'tags: [ft]',
    'tv-color: red',
    '---',
    '# h',
    '- tv-linestyle:: dashed',
    '- area:: lab',
    '- [ ] t',
    '    - x:: 1',
    '      y',
], DEFAULT_SETTINGS, namesOutsideIndex('n.md')).tasks[0];

function formOn(openSource: HubHost['openSource']) {
    const doc = new FocusDoc();
    // The color's swatch reads the color by a canvas, which there is none of here.
    Object.assign(doc, { createElement: () => ({ getContext: () => null }) });
    const root = doc.root();
    const host: HubHost = {
        task: () => ROW,
        put: async () => true,
        shut: () => null,
        openSource,
        draft: () => null,
        closing: () => 'close',
        bind: () => { },
    };
    const app = { keymap: { pushScope: () => { }, popScope: () => { } } } as never;
    const menus = menuSpy();
    const plugin = { settings: DEFAULT_SETTINGS, menuPresenter: menus.presenter } as never;
    const index = { getTasks: () => [], getTask: () => ROW, onChange: () => () => { } } as never;
    new TaskHubForm(asEl(root), host, { app, plugin, index, foot: asEl(root) });
    /** The menu of the field `label` names, opened. */
    const menuOf = (label: string) => {
        click(root.findAll('tv-form__menu-button').find(el => el.attrs.get('aria-label') === `Menu of ${label}`)!);
        return menus.last()!.items;
    };
    /** The "open inherited line" of the field `label` names, from its menu. */
    const openOf = (label: string) => menuOf(label).find(item => item.title === 'Open inherited line')!;
    return {
        root,
        tag: root.find('task-hub__tag-chip--cascade')!,
        actions: root.findAll('tv-form__issue-action'),
        menuOf,
        /** The style's and the property's "open inherited line". */
        opens: () => ['Color', 'Line style', 'area'].map(openOf),
    };
}

const click = (el: FocusEl) => el.dispatchEvent(new Event('click'));

describe('where an inherited value comes from', () => {
    it('opens the line each says, with a row to open', () => {
        const open = vi.fn();
        const f = formOn(open);
        expect(f.actions).toHaveLength(1);
        // The menu's head says where the value is written.
        expect(f.menuOf('Color')[0]).toMatchObject({ title: 'Inherited from file', disabled: true });
        expect(f.menuOf('Line style')[0]).toMatchObject({ title: 'Inherited from section', disabled: true });

        for (const el of [f.tag, ...f.actions]) click(el);
        for (const item of f.opens()) item.click!();
        expect(open).toHaveBeenCalledTimes(5);
    });

    it('is said, its menu item greyed, and pressed does nothing, with no row to open', () => {
        const f = formOn(null);
        for (const item of f.opens()) expect(item).toMatchObject({ disabled: true, click: null });

        expect(() => click(f.tag)).not.toThrow();
        // The finding is said, with nothing to press.
        expect(f.root.findAll('tv-form__warning')).toHaveLength(1);
        expect(f.actions).toHaveLength(0);
    });
});
