import { describe, it, expect, vi, afterEach } from 'vitest';
import { TaskHubPanel, type TaskHubDeps } from '../../../src/modals/hub/TaskHubPanel';
import type { PanelHost } from '../../../src/modals/hub/HubHost';
import type { PlaceFieldsHost } from '../../../src/modals/place/PlaceFields';
import type { DestinationAsk, NoteRead } from '../../../src/services/data/NotePlaces';
import type { CreatePlace, CreatePlaces, PlaceFacts } from '../../../src/services/data/CreatePlaces';
import type { SourceHost } from '../../../src/modals/hub/TaskHubSource';
import type { WriteAnswer } from '../../../src/services/operations/WriteAnswer';
import { DEFAULT_SETTINGS } from '../../../src/types/Settings';
import { t } from '../../../src/i18n';
import ja from '../../../src/i18n/locales/ja.json';
import en from '../../../src/i18n/locales/en.json';
import type { Task } from '../../../src/types';
import { makeTask } from '../helpers/makeTask';
import { FocusDoc, type FocusEl } from '../helpers/focusDom';

/**
 * The hub's panel as it joins its pieces, opened by its two entries. On a
 * row: the source mode built in the panel's slots, following the row the
 * host follows and waiting for the host's writes, and hubs on rows open one
 * at a time. On a task not written yet: no source mode, the card drawn as
 * one nothing is done on and drawn again as the draft changes, and the hub
 * opened over a hub on a row, which it leaves open, with a place tab whose
 * fields open on the place it is put in, or on none for the user to choose.
 * The overlay, the form, the place tab's pane, and the source mode's own
 * logic and surface stand in here; the hosts are the real ones, on a
 * stand-in index and stand-in places.
 */

// The icon a tab shows, read back from its element.
vi.mock('obsidian', async (importOriginal) => ({
    ...await importOriginal<typeof import('obsidian')>(),
    setIcon: (el: FocusEl, icon: string) => { el.setAttribute('data-icon', icon); },
}));

const { shells, forms, sources, views, panes, paneHas } = vi.hoisted(() => ({
    shells: [] as { opts: { build(body: unknown, frame: unknown): void; onClose?: () => void; beforeClose?: () => unknown; initialFocus?: () => unknown } | null; close(): void }[],
    forms: [] as { host: unknown; deps: Record<string, unknown>; beforeClose: ReturnType<typeof vi.fn>; focusOf: ReturnType<typeof vi.fn> }[],
    sources: [] as { task: unknown; host: unknown; follow: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }[],
    views: [] as { bar: unknown; card: unknown; pane: unknown; foot: unknown }[],
    panes: [] as { el: unknown; input: unknown; opts: { initial: unknown; host: unknown }; setEnabled: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }[],
    /** Whether the place pane built next has a field: one shown with none focuses nothing. */
    paneHas: { field: true },
}));
const body = { current: null as FocusEl | null, head: null as FocusEl | null, foot: null as FocusEl | null };

vi.mock('../../../src/views/sharedUI/OverlayShell', () => ({
    OverlayShell: class {
        opts: { build(body: unknown, frame: unknown): void; onClose?: () => void } | null = null;
        constructor() { shells.push(this); }
        isOpen() { return this.opts !== null; }
        open(opts: { build(body: unknown, frame: unknown): void; onClose?: () => void }) {
            this.opts = opts;
            opts.build(body.current, { head: body.head, foot: body.foot });
        }
        async requestClose() { this.close(); return true; }
        close() {
            const opts = this.opts;
            this.opts = null;
            opts?.onClose?.();
        }
    },
}));
vi.mock('../../../src/modals/hub/TaskHubForm', () => ({
    TaskHubForm: class {
        beforeClose = vi.fn(() => 'close');
        constructor(_el: unknown, readonly host: { bind(form: unknown): void }, readonly deps: { place?: { pane: { focus(): unknown; refresh(): void } } }) {
            host.bind(this);
            forms.push(this);
        }
        fieldElement() { return null; }
        focusField() { }
        // The place tab's first field is the place pane's, as the form answers it.
        focusOf = vi.fn((field: string) => (field === 'place' ? this.deps.place?.pane.focus() ?? null : null));
        // Drawn again from the host, the place pane with the form's fields.
        refresh() { this.deps.place?.pane.refresh(); }
        showShut() { }
        showDraft() { }
        sayWrite() { }
        sayPlace() { }
        create() { }
    },
}));
vi.mock('../../../src/modals/hub/TaskHubSource', () => ({
    TaskHubSource: class {
        follow = vi.fn();
        dispose = vi.fn();
        beforeClose() { return true; }
        yieldsEscape() { return false; }
        takesBack() { return false; }
        constructor(readonly task: unknown, readonly host: unknown) { sources.push(this); }
    },
}));
vi.mock('../../../src/modals/hub/TaskHubSourceView', () => ({
    TaskHubSourceView: class {
        constructor(_app: unknown, readonly bar: unknown, readonly card: unknown, readonly pane: unknown, readonly foot: unknown) { views.push(this); }
    },
}));

vi.mock('../../../src/modals/place/PlacePane', () => ({
    // One field, as the pane's first: what the panel hands it, and how it is shut, recorded.
    PlacePane: class {
        readonly input: unknown;
        setEnabled = vi.fn();
        refresh = vi.fn();
        dispose = vi.fn();
        constructor(_app: unknown, readonly el: { createEl(tag: string): unknown }, readonly opts: { initial: unknown; host: unknown }) {
            this.input = el.createEl('input');
            panes.push(this);
        }
        focus() { return paneHas.field ? { to: this.input, selection: 'end' } : null; }
    },
}));

afterEach(() => {
    for (const shell of shells) shell.close();
    shells.length = 0;
    forms.length = 0;
    sources.length = 0;
    views.length = 0;
    panes.length = 0;
    paneHas.field = true;
});

/** A body to build in, and the panel's deps, the card's draws counted by the content each drew. */
function rig(updateTask: () => Promise<WriteAnswer> = async () => ({ written: true })) {
    const doc = new FocusDoc();
    body.current = doc.root();
    body.head = doc.root();
    body.foot = doc.root();
    const drawn: string[] = [];
    let copy: Task | undefined = makeTask({ id: 'task-1', content: '元の名前' });
    const listeners: ((taskId?: string) => void)[] = [];
    const index = {
        getTask: () => copy,
        getTasks: () => [],
        onChange: (listener: (taskId?: string) => void) => {
            listeners.push(listener);
            return () => { listeners.splice(listeners.indexOf(listener), 1); };
        },
    };
    const deps: TaskHubDeps = {
        taskRenderer: {
            render: vi.fn((_el: unknown, dt: Task) => { drawn.push(dt.content); }),
            disposeInside: vi.fn(),
        } as never,
        index: index as never,
        operations: { updateTask: vi.fn(updateTask) } as never,
        plugin: { settings: DEFAULT_SETTINGS } as never,
    };
    // New notes go in Inbox, whatever note they are reckoned from.
    const app = { keymap: {}, fileManager: { getNewFileParent: () => ({ path: 'Inbox' }) } } as never;
    /** The index changes the row to `row`, and says so. */
    const change = (row: Task | undefined) => {
        copy = row;
        for (const listener of [...listeners]) listener('task-1');
    };
    return { body: body.current, deps, app, drawn, change, listeners };
}

/** The vault as the place fields name it: no note while they name none. */
const notePlaces = { readFields: async (): Promise<NoteRead> => ({ kind: 'unnamed', why: { ok: false, why: 'empty', at: 'name' } }) };

/** The places a draft is put in: a daily note, answered at once. */
const places = {
    noteOf: () => '2031-01-15.md',
    facts: async (): Promise<PlaceFacts> => ({
        kind: 'note', path: '2031-01-15.md', spot: { heading: 'Tasks', level: 2, side: 'head' },
        note: 'existing', seed: 'daily', heading: { kind: 'none' }, ignored: false, inherits: {},
    }),
    create: async (): Promise<WriteAnswer> => ({ written: true }),
    fromDestination: () => PLACE,
    askOf: (): DestinationAsk => ({ note: { text: '2031-01-15', picked: '2031-01-15.md' }, heading: 'Tasks' }),
} as unknown as CreatePlaces;
const PLACE: CreatePlace = { kind: 'note', note: { kind: 'daily', date: '2031-01-15' }, spot: { heading: 'Tasks', level: 2, side: 'head' } };
const CHILD: CreatePlace = { kind: 'childOf', taskId: 'task-1' };

/** What each draw of the card was given: its content, and whether it is one nothing is done on. */
const draws = (deps: TaskHubDeps) => (deps.taskRenderer.render as ReturnType<typeof vi.fn>).mock.calls
    .map(([, dt, , options]) => ({ content: (dt as Task).content, inert: (options as { inert?: boolean }).inert }));

describe('a hub with nothing to wait for', () => {
    /** Whether shell `n` is open with its card drawn, read the moment the call returns. */
    const openAndDrawn = (deps: TaskHubDeps, n: number) =>
        shells[n]?.opts != null && (deps.taskRenderer.render as ReturnType<typeof vi.fn>).mock.calls.length > 0;

    it('on a row, with no hub open, is open with its card drawn as the call returns', () => {
        const r = rig();
        void TaskHubPanel.openRowHub(r.app, makeTask({ id: 'task-1' }), r.deps);

        expect(openAndDrawn(r.deps, 0)).toBe(true);
    });

    it('on a task not written yet is open with its card drawn as the call returns', () => {
        const r = rig();
        void TaskHubPanel.openDraftHub(r.app, PLACE, { content: '下書き' }, { ...r.deps, places, notePlaces });

        expect(openAndDrawn(r.deps, 0)).toBe(true);
    });

    it('on a task not written yet, over a hub on a row, is open with its card drawn as the call returns', async () => {
        const r = rig();
        await TaskHubPanel.openRowHub(r.app, makeTask({ id: 'task-1' }), r.deps);
        (r.deps.taskRenderer.render as ReturnType<typeof vi.fn>).mockClear();
        void TaskHubPanel.openDraftHub(r.app, PLACE, { content: '下書き' }, { ...r.deps, places, notePlaces });

        expect(shells.map(shell => shell.opts !== null)).toEqual([true, true]);
        expect(openAndDrawn(r.deps, 1)).toBe(true);
    });
});

describe('the hub on a task not written yet', () => {
    it('builds no source mode, nor its switch, and draws its card as one nothing is done on', async () => {
        const r = rig();
        await TaskHubPanel.openDraftHub(r.app, CHILD, { content: '下書き' }, { ...r.deps, places, notePlaces });

        // The card, and under it the tabs: no switch above the card.
        expect(r.body.children.map(child => [...child.classes].join(' '))).toEqual(['task-hub__preview', 'tv-tabs', 'tv-tabs__panes']);
        expect(sources).toHaveLength(0);
        expect(forms).toHaveLength(1);
        // Drawn as it opens, and again once the place has answered.
        expect(draws(r.deps).length).toBeGreaterThan(0);
        expect(draws(r.deps).every(draw => draw.content === '下書き' && draw.inert === true)).toBe(true);
    });

    it('is titled as the task it creates, above the body', async () => {
        const r = rig();
        await TaskHubPanel.openDraftHub(r.app, PLACE, {}, { ...r.deps, places, notePlaces });

        expect(body.head!.children.map(child => child.text)).toEqual([t('modal.newTask.title')]);
        // The one dialog that creates the task: its properties and its place both.
        expect([ja.modal.newTask.title, en.modal.newTask.title]).toEqual(['新しいタスクを作成', 'Create new task']);
    });

    it('draws the card again as the draft is handed a change, once the field is done', async () => {
        const r = rig();
        await TaskHubPanel.openDraftHub(r.app, PLACE, {}, { ...r.deps, places, notePlaces });
        const host = forms[0].host as PanelHost;
        await Promise.resolve();

        void host.put({ content: '一' });
        expect(r.drawn.at(-1)).not.toBe('一');
        await Promise.resolve();
        expect(r.drawn.at(-1)).toBe('一');
    });

    it('opens over a hub on a row, which stays open once it closes', async () => {
        const r = rig();
        await TaskHubPanel.openRowHub(r.app, makeTask({ id: 'task-1' }), r.deps);
        await TaskHubPanel.openDraftHub(r.app, PLACE, {}, { ...r.deps, places, notePlaces });

        expect(shells.map(shell => shell.opts !== null)).toEqual([true, true]);
        shells[1].close();
        expect(shells.map(shell => shell.opts !== null)).toEqual([true, false]);
        expect(r.listeners).toHaveLength(1);
    });
});

describe('the hub on a task not written yet, its place tab', () => {
    const tabs = (r: ReturnType<typeof rig>) => r.body.find('tv-tabs')!.findAll('tv-tabs__tab');
    const selected = (r: ReturnType<typeof rig>) => tabs(r).map(tab => tab.attrs.get('aria-selected'));

    it('puts the tabs under the card, properties and place by their keys, the form and the place\'s fields each in its pane', async () => {
        const r = rig();
        await TaskHubPanel.openDraftHub(r.app, PLACE, {}, { ...r.deps, places, notePlaces });

        expect(r.body.children.map(child => [...child.classes].join(' '))).toEqual(['task-hub__preview', 'tv-tabs', 'tv-tabs__panes']);
        expect(r.body.classes.has('task-hub__body--tabs')).toBe(true);
        expect(tabs(r).map(tab => tab.find('tv-tabs__label')!.text)).toEqual([t('modal.hub.tabProperties'), t('modal.hub.tabPlace')]);
        expect(tabs(r).map(tab => tab.find('tv-tabs__icon')!.attrs.get('data-icon'))).toEqual(['list', 'map-pin']);
        expect(tabs(r).map(tab => tab.attrs.get('data-tab'))).toEqual(['properties', 'place']);
        const [properties, place] = r.body.find('tv-tabs__panes')!.children;
        expect(properties.children.map(child => [...child.classes].join(' '))).toEqual(['task-hub__form']);
        expect(panes.map(pane => pane.el)).toEqual([place]);
    });

    it('in a note, opens on the properties, the place\'s fields on that note and its heading', async () => {
        const r = rig();
        await TaskHubPanel.openDraftHub(r.app, PLACE, {}, { ...r.deps, places, notePlaces });

        expect(selected(r)).toEqual(['true', 'false']);
        expect(panes[0].opts.initial).toEqual({ note: { text: '2031-01-15', picked: '2031-01-15.md' }, heading: 'Tasks' });
    });

    it('on no place, opens on the place, the note field empty and the heading the settings\', the first focus on the place\'s first field', async () => {
        const r = rig();
        await TaskHubPanel.openDraftHub(r.app, null, {}, { ...r.deps, places, notePlaces });

        expect(selected(r)).toEqual(['false', 'true']);
        expect(panes[0].opts.initial).toEqual({ note: { text: '', picked: null }, heading: DEFAULT_SETTINGS.taskHeading });
        expect(shells.at(-1)!.opts!.initialFocus!()).toEqual({ to: panes[0].input, selection: 'end' });
    });

    it('opens on the properties when the place\'s pane has no field to focus first', async () => {
        const r = rig();
        paneHas.field = false;
        await TaskHubPanel.openDraftHub(r.app, null, {}, { ...r.deps, places, notePlaces });

        expect(selected(r)).toEqual(['true', 'false']);
        expect(shells.at(-1)!.opts!.initialFocus!()).toBeNull();
    });

    it('under a row, has the tabs, its place shown with no field, and opens on the properties with the focus on the name', async () => {
        const r = rig();
        await TaskHubPanel.openDraftHub(r.app, CHILD, {}, { ...r.deps, places, notePlaces });

        expect(r.body.children.map(child => [...child.classes].join(' '))).toEqual(['task-hub__preview', 'tv-tabs', 'tv-tabs__panes']);
        expect(panes).toHaveLength(0);
        expect(selected(r)).toEqual(['true', 'false']);
        const [, place] = r.body.find('tv-tabs__panes')!.children;
        expect(place.find('task-hub__shown')).not.toBeNull();
        shells.at(-1)!.opts!.initialFocus!();
        expect(forms[0].focusOf).toHaveBeenLastCalledWith('name');
    });

    it('under a row, shows the parent\'s note, heading and text in the place tab once the place is read', async () => {
        const r = rig();
        let answer = (_facts: PlaceFacts) => { };
        const facts = () => new Promise<PlaceFacts>(resolve => { answer = resolve; });
        await TaskHubPanel.openDraftHub(r.app, CHILD, {}, { ...r.deps, places: { ...places, facts } as unknown as CreatePlaces, notePlaces });
        const values = () => r.body.find('tv-tabs__panes')!.findAll('task-hub__shown-value').map(value => value.text);
        expect(values()).toEqual(['', '', '']);

        answer({ kind: 'childOf', parent: '親', path: 'f/n.md', under: 'Work', inherits: {} });
        await Promise.resolve();
        await Promise.resolve();
        expect(values()).toEqual(['f/n.md', 'Work', '親']);
    });

    it('hands the form the place pane, and the tab chosen for an element', async () => {
        const r = rig();
        await TaskHubPanel.openDraftHub(r.app, PLACE, {}, { ...r.deps, places, notePlaces });

        const deps = forms[0].deps as { place: { el: unknown; pane: unknown }; reveal: (el: Element) => void };
        expect(deps.place).toEqual({ el: panes[0].el, pane: panes[0] });
        deps.reveal(panes[0].input as Element);
        expect(selected(r)).toEqual(['false', 'true']);
    });

    it('reads the place\'s fields with a new note\'s folder reckoned from no note', async () => {
        const r = rig();
        const readFields = vi.fn(notePlaces.readFields);
        await TaskHubPanel.openDraftHub(r.app, null, {}, { ...r.deps, places, notePlaces: { readFields } });
        const ask: DestinationAsk = { note: { text: 'Plan', picked: null }, heading: '' };
        await (panes[0].opts.host as PlaceFieldsHost).read(ask);

        expect(readFields).toHaveBeenCalledWith(ask, 'Inbox');
    });

    it('moves the draft by the place\'s fields: what they answer is read as the place it is put in', async () => {
        const r = rig();
        const facts = vi.fn(places.facts);
        await TaskHubPanel.openDraftHub(r.app, null, {}, { ...r.deps, places: { ...places, facts } as unknown as CreatePlaces, notePlaces });
        const host = panes[0].opts.host as PlaceFieldsHost;
        const draft = (forms[0].host as PanelHost).draft!;
        expect(facts).not.toHaveBeenCalled();
        expect(draft.canCreate()).toBe(false);

        host.reading();
        host.answered({ kind: 'to', to: { note: { kind: 'existing', path: '2031-01-15.md' }, spot: { heading: 'Tasks', level: 2, side: 'head' } } });
        await Promise.resolve();
        await Promise.resolve();

        expect(facts).toHaveBeenCalledWith(PLACE);
        expect(draft.canCreate()).toBe(true);
    });

    it('lets the place pane go as it closes', async () => {
        const r = rig();
        await TaskHubPanel.openDraftHub(r.app, PLACE, {}, { ...r.deps, places, notePlaces });
        shells[0].close();
        expect(panes[0].dispose).toHaveBeenCalledTimes(1);
    });
});

describe('the hub on a row', () => {
    it('is titled as editing the properties, above the body', async () => {
        const r = rig();
        await TaskHubPanel.openRowHub(r.app, makeTask({ id: 'task-1' }), r.deps);

        expect(body.head!.children.map(child => child.text)).toEqual([t('modal.hub.title')]);
    });

    it('builds the source mode on the row, in the panel\'s slots', async () => {
        const r = rig();
        await TaskHubPanel.openRowHub(r.app, makeTask({ id: 'task-1', content: '元の名前' }), r.deps);

        expect(sources).toHaveLength(1);
        expect(sources[0].task).toMatchObject({ id: 'task-1', content: '元の名前' });
        const [bar, card, pane] = r.body.children;
        expect(views[0]).toMatchObject({ bar, card, pane, foot: body.foot });
    });

    it('closes when the source mode asks it to', async () => {
        const r = rig();
        await TaskHubPanel.openRowHub(r.app, makeTask({ id: 'task-1' }), r.deps);

        (sources[0].host as SourceHost).closeHub();
        expect(shells[0].opts).toBeNull();
        expect(r.listeners).toHaveLength(0);
    });

    it('opens once the hub on a row open now has closed: one at a time', async () => {
        const r = rig();
        await TaskHubPanel.openRowHub(r.app, makeTask({ id: 'task-1' }), r.deps);
        await TaskHubPanel.openRowHub(r.app, makeTask({ id: 'task-1' }), r.deps);

        expect(shells.map(shell => shell.opts !== null)).toEqual([false, true]);
        expect(r.listeners).toHaveLength(1);
    });

    it('draws a change of the row in the card, then tells the source mode of it', async () => {
        const r = rig();
        await TaskHubPanel.openRowHub(r.app, makeTask({ id: 'task-1' }), r.deps);
        const order: string[] = [];
        sources[0].follow.mockImplementation((row: Task | undefined) => { order.push(`follow:${row?.content ?? 'none'}`); });
        (r.deps.taskRenderer.render as ReturnType<typeof vi.fn>).mockImplementation((_el: unknown, dt: Task) => { order.push(`card:${dt.content}`); });

        r.change(makeTask({ id: 'task-1', content: '外の名前' }));
        r.change(undefined);

        expect(order).toEqual(['card:外の名前', 'follow:外の名前', 'follow:none']);
    });

    it('lets the source mode open only once the writes the form asked are done', async () => {
        let release!: () => void;
        const r = rig(() => new Promise<WriteAnswer>(resolve => { release = () => resolve({ written: true }); }));
        await TaskHubPanel.openRowHub(r.app, makeTask({ id: 'task-1' }), r.deps);
        const host = forms[0].host as PanelHost;
        const sourceHost = sources[0].host as SourceHost;

        void host.put({ content: '打った名前' });
        let drained = false;
        const waiting = sourceHost.drained().then(() => { drained = true; });
        await Promise.resolve();
        expect(drained).toBe(false);
        release();
        await waiting;
        expect(drained).toBe(true);
    });

    it('follows the row no more once the hub has closed, and lets the source mode go', async () => {
        const r = rig();
        await TaskHubPanel.openRowHub(r.app, makeTask({ id: 'task-1' }), r.deps);
        shells[0].close();

        expect(r.listeners).toHaveLength(0);
        expect(sources[0].dispose).toHaveBeenCalledTimes(1);
    });
});
