import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { TaskHubForm } from '../../../src/modals/hub/TaskHubForm';
import type { HubHost } from '../../../src/modals/hub/HubHost';
import { FileParsePipeline } from '../../../src/services/parsing/FileParsePipeline';
import { namesOutsideIndex } from '../../../src/services/core/RowNames';
import { DEFAULT_SETTINGS } from '../../../src/types/Settings';
import type { Task } from '../../../src/types';
import { FocusDoc, FocusEl, asEl } from '../helpers/focusDom';

/**
 * Where the hub's fields say an inherited value comes from: the tag's chip,
 * the style's label, a property's label, and a finding's "open the line".
 * With a host that has a row to open, each opens the line; with one that
 * has none (`HubHost.openSource` null), each is said and nothing is
 * listened for: the labels are drawn as nothing to press, and a finding
 * offers no action.
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
        draft: null,
        closing: () => 'close',
        bind: () => { },
    };
    const app = { keymap: { pushScope: () => { }, popScope: () => { } } } as never;
    const plugin = { settings: DEFAULT_SETTINGS, menuPresenter: { present: () => { } } } as never;
    const index = { getTasks: () => [], getTask: () => ROW, onChange: () => () => { } } as never;
    new TaskHubForm(asEl(root), host, { app, plugin, index });
    const labels = root.findAll('task-hub__source').filter(el => el.text !== '');
    return {
        root,
        tag: root.find('task-hub__tag-chip--cascade')!,
        labels,
        actions: root.findAll('tv-form__issue-action'),
    };
}

const click = (el: FocusEl) => el.dispatchEvent(new Event('click'));

describe('where an inherited value comes from', () => {
    it('opens the line each says, with a row to open', () => {
        const open = vi.fn();
        const f = formOn(open);
        expect(f.labels).toHaveLength(3);
        expect(f.actions).toHaveLength(1);

        for (const el of [f.tag, ...f.labels, ...f.actions]) click(el);
        expect(open).toHaveBeenCalledTimes(5);
        expect(f.labels.every(el => !el.classes.has('task-hub__source--plain'))).toBe(true);
    });

    it('is said, drawn as nothing to press, and pressed does nothing, with no row to open', () => {
        const f = formOn(null);
        expect(f.labels).toHaveLength(3);
        expect(f.labels.every(el => el.classes.has('task-hub__source--plain'))).toBe(true);

        for (const el of [f.tag, ...f.labels]) expect(() => click(el)).not.toThrow();
        // The finding is said, with nothing to press.
        expect(f.root.findAll('tv-form__warning')).toHaveLength(1);
        expect(f.actions).toHaveLength(0);
    });
});
