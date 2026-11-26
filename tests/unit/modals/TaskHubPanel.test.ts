import { describe, it, expect, vi, afterEach } from 'vitest';
import { TaskHubPanel, type TaskHubDeps } from '../../../src/modals/hub/TaskHubPanel';
import type { PanelHost } from '../../../src/modals/hub/HubHost';
import type { PlaceFieldsHost } from '../../../src/modals/place/PlaceFields';
import type { DestinationAsk, NoteRead } from '../../../src/services/data/NotePlaces';
import type { CreatePlace, CreatePlaces, PlaceFacts } from '../../../src/services/data/CreatePlaces';
import type { SourceHost } from '../../../src/modals/hub/TaskHubSource';
import type { SourceApply } from '../../../src/modals/hub/SourceApply';
import { SubtreeFrame } from '../../../src/services/persistence/utils/SubtreeFrame';
import type { WriteAnswer } from '../../../src/services/operations/WriteAnswer';
import type { SendPreview } from '../../../src/services/data/NoteOps';
import type { TaskMenuHooks } from '../../../src/interaction/menu/MenuHandler';
import type { RenderOptions } from '../../../src/views/taskcard/TaskCardRenderer';
import { DEFAULT_SETTINGS } from '../../../src/types/Settings';
import { t } from '../../../src/i18n';
import ja from '../../../src/i18n/locales/ja.json';
import en from '../../../src/i18n/locales/en.json';
import type { Task } from '../../../src/types';
import { makeTask } from '../helpers/makeTask';
import { FocusDoc, type FocusEl } from '../helpers/focusDom';
import { TFile } from '../mocks/obsidian';

/**
 * The hub's panel as it joins its pieces, opened by its two entries. On a
 * row: the source mode built in the panel's slots, its seat the host's,
 * drawn on the row the host follows and waiting for the host's writes, and hubs on rows open one
 * at a time. On a task not written yet: no source mode, the card drawn as
 * one nothing is done on and drawn again as the draft changes, and the hub
 * opened over a hub on a row, which it leaves open, with the place's fields
 * handed to the form to build, open on the place it is put in, or on none
 * for the user to choose. The overlay, the form, the place's fields, and the
 * source mode's own logic and surface stand in here; the hosts are the real
 * ones, on a stand-in index and stand-in places.
 */

const { shells, forms, sources, views, panes, paneHas } = vi.hoisted(() => ({
    shells: [] as { opts: { build(body: unknown, frame: unknown): void; onClose?: () => void; beforeClose?: () => unknown; initialFocus?: () => unknown } | null; close(): void }[],
    forms: [] as { el: unknown; host: unknown; deps: Record<string, unknown>; beforeClose: ReturnType<typeof vi.fn>; focusOf: ReturnType<typeof vi.fn>; notWritten: ReturnType<typeof vi.fn>; focusPlace: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }[],
    sources: [] as { host: unknown; redraw: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }[],
    views: [] as { slots: Record<string, unknown> }[],
    panes: [] as { el: unknown; input: unknown; opts: { initial: unknown; host: unknown }; setEnabled: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }[],
    /** Whether the place's fields built next have a field: a place shown with none focuses nothing. */
    paneHas: { field: true },
}));
const body = { panel: null as FocusEl | null, current: null as FocusEl | null, head: null as FocusEl | null, foot: null as FocusEl | null };

vi.mock('../../../src/views/sharedUI/OverlayShell', () => ({
    OverlayShell: class {
        opts: { build(body: unknown, frame: unknown): void; onClose?: () => void } | null = null;
        constructor() { shells.push(this); }
        isOpen() { return this.opts !== null; }
        getPanel() { return this.opts ? body.panel : null; }
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
interface StandInPlace { focus(): unknown; refresh(): void; dispose(): void }
vi.mock('../../../src/modals/hub/TaskHubForm', () => ({
    TaskHubForm: class {
        beforeClose = vi.fn(() => 'close');
        /** The place, built where the form's basic tab would be: an element of its own in the form's. */
        readonly place: StandInPlace | null;
        constructor(readonly el: { createDiv(): unknown }, readonly host: { bind(form: unknown): void }, readonly deps: { place?: (parent: unknown) => StandInPlace }) {
            this.place = deps.place?.(el.createDiv()) ?? null;
            host.bind(this);
            forms.push(this);
        }
        fieldElement() { return null; }
        focusField() { }
        // The first field of the place is the place's, as the form answers it.
        focusOf = vi.fn((field: string) => (field === 'place' ? this.place?.focus() ?? null : null));
        // Drawn again from the host, the place with the form's fields.
        refresh() { this.place?.refresh(); }
        showShut() { }
        showDraft() { }
        sayPut() { }
        sayWrite() { }
        sayPlace() { }
        putTyped() { return true; }
        create() { }
        notWritten = vi.fn();
        edited() { }
        focusPlace = vi.fn();
        dispose = vi.fn(() => { this.place?.dispose(); });
    },
}));
vi.mock('../../../src/modals/hub/TaskHubSource', () => ({
    TaskHubSource: class {
        redraw = vi.fn();
        hold = vi.fn();
        dispose = vi.fn();
        beforeClose() { return true; }
        yieldsEscape() { return false; }
        takesBack() { return false; }
        constructor(readonly host: unknown) { sources.push(this); }
    },
}));
vi.mock('../../../src/modals/hub/TaskHubSourceView', () => ({
    TaskHubSourceView: class {
        constructor(_app: unknown, readonly slots: Record<string, unknown>) { views.push(this); }
    },
}));

vi.mock('../../../src/modals/place/PlacePane', () => ({
    // One field, as the place's first: what the panel hands it, and how it is shut, recorded.
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
function rig(updateTask: () => Promise<WriteAnswer> = async () => ({ written: true }), noteOps: object = {}) {
    const doc = new FocusDoc();
    // The overlay's panel: its head, its body and its foot in it.
    body.panel = doc.root();
    body.head = body.panel.createDiv();
    body.current = body.panel.createDiv();
    body.foot = body.panel.createDiv();
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
        plugin: { settings: DEFAULT_SETTINGS, getNoteOps: () => noteOps } as never,
    };
    // The row's note, the row above its first heading: read for the heading the row stands under.
    const notes: Record<string, string> = { 'note.md': '- [ ] Test task @2026-03-11\n# 見出し\n' };
    const vault = {
        getAbstractFileByPath: (path: string) => (path in notes ? Object.assign(new TFile(), { path }) : null),
        cachedRead: async (file: TFile) => notes[file.path],
    };
    // New notes go in Inbox, whatever note they are reckoned from.
    const app = { keymap: {}, vault, fileManager: { getNewFileParent: () => ({ path: 'Inbox' }) } } as never;
    /** The index changes the row to `row`, and says so. */
    const change = (row: Task | undefined) => {
        copy = row;
        for (const listener of [...listeners]) listener('task-1');
    };
    return { doc, panel: body.panel, body: body.current, deps, app, drawn, change, listeners };
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

/** What the panel handed form `n` to build the place with, and to open on. */
const handedOf = (n: number) => {
    const deps = forms[n].deps as { place?: unknown; opensOn?: string };
    return { place: deps.place, opensOn: deps.opensOn };
};

/**
 * What each draw of the card was given: its content, and the rows it reads
 * in place of the index (`RenderOptions.rows`), which make it one nothing is
 * done on; undefined, it reads the index.
 */
const draws = (deps: TaskHubDeps) => (deps.taskRenderer.render as ReturnType<typeof vi.fn>).mock.calls
    .map(([, dt, , options]) => ({ task: dt as Task, content: (dt as Task).content, rows: (options as RenderOptions).rows }));

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

        // The card, and under it the form: no switch above the card.
        expect(r.body.children.map(child => [...child.classes].join(' '))).toEqual(['task-hub__preview', 'task-hub__form']);
        expect(sources).toHaveLength(0);
        expect(forms).toHaveLength(1);
        // Drawn as it opens, and again once the place has answered.
        expect(draws(r.deps).length).toBeGreaterThan(0);
        expect(draws(r.deps).every(draw => draw.content === '下書き' && draw.rows?.(draw.task.id)?.content === '下書き')).toBe(true);
    });

    it('is titled as the task it creates, above the body, the title alone on its line', async () => {
        const r = rig();
        await TaskHubPanel.openDraftHub(r.app, PLACE, {}, { ...r.deps, places, notePlaces });

        expect(body.head!.children.map(child => child.text)).toEqual([t('modal.newTask.title')]);
        expect(body.head!.classes.has('task-hub__head')).toBe(false);
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

describe('the hub on a task not written yet, its place', () => {
    /** What the panel handed the form to build the place with, and to open on. */
    const handed = () => forms[0].deps as { place?: unknown; opensOn?: string };

    it('lays the form out with the card in its body, the form building the place handed to it', async () => {
        const r = rig();
        await TaskHubPanel.openDraftHub(r.app, PLACE, {}, { ...r.deps, places, notePlaces });

        expect(r.body.children.map(child => [...child.classes].join(' '))).toEqual(['task-hub__preview', 'task-hub__form']);
        expect(r.body.classes.has('task-hub__body--tabs')).toBe(true);
        expect(forms[0].el).toBe(r.body.find('task-hub__form'));
        expect(typeof handed().place).toBe('function');
        expect(panes).toHaveLength(1);
        expect(r.body.find('task-hub__form')!.contains(panes[0].el as FocusEl)).toBe(true);
    });

    it('in a note, opens on the name, the place\'s fields on that note and its heading', async () => {
        const r = rig();
        await TaskHubPanel.openDraftHub(r.app, PLACE, {}, { ...r.deps, places, notePlaces });

        expect(handed().opensOn).toBe('name');
        expect(panes[0].opts.initial).toEqual({ note: { text: '2031-01-15', picked: '2031-01-15.md' }, heading: 'Tasks' });
    });

    it('on no place, opens on the place, the note field empty and the heading the settings\', the first focus on the place\'s first field', async () => {
        const r = rig();
        await TaskHubPanel.openDraftHub(r.app, null, {}, { ...r.deps, places, notePlaces });

        expect(handed().opensOn).toBe('place');
        expect(panes[0].opts.initial).toEqual({ note: { text: '', picked: null }, heading: DEFAULT_SETTINGS.taskHeading });
        expect(shells.at(-1)!.opts!.initialFocus!()).toEqual({ to: panes[0].input, selection: 'end' });
    });

    it('focuses nothing first when the place has no field to focus', async () => {
        const r = rig();
        paneHas.field = false;
        await TaskHubPanel.openDraftHub(r.app, null, {}, { ...r.deps, places, notePlaces });

        expect(shells.at(-1)!.opts!.initialFocus!()).toBeNull();
    });

    it('under a row, has its place shown with no field in the form, and opens on the name', async () => {
        const r = rig();
        await TaskHubPanel.openDraftHub(r.app, CHILD, {}, { ...r.deps, places, notePlaces });

        expect(panes).toHaveLength(0);
        expect(r.body.find('task-hub__form')!.find('task-hub__shown')).not.toBeNull();
        expect(handed().opensOn).toBe('name');
        shells.at(-1)!.opts!.initialFocus!();
        expect(forms[0].focusOf).toHaveBeenLastCalledWith('name');
    });

    it('under a row, shows the parent\'s note, heading and text once the place is read', async () => {
        const r = rig();
        let answer = (_facts: PlaceFacts) => { };
        const facts = () => new Promise<PlaceFacts>(resolve => { answer = resolve; });
        await TaskHubPanel.openDraftHub(r.app, CHILD, {}, { ...r.deps, places: { ...places, facts } as unknown as CreatePlaces, notePlaces });
        const values = () => r.body.findAll('task-hub__shown-value').map(value => value.text);
        expect(values()).toEqual(['', '', '']);

        answer({ kind: 'childOf', parent: '親', path: 'f/n.md', under: 'Work', inherits: {} });
        await Promise.resolve();
        await Promise.resolve();
        expect(values()).toEqual(['f/n.md', 'Work', '親']);
    });

    it('hands the form whether the focus is in the hub: on anything in its panel but the panel itself', async () => {
        const r = rig();
        await TaskHubPanel.openDraftHub(r.app, PLACE, {}, { ...r.deps, places, notePlaces });
        const hasFocus = (forms[0].deps as { hasFocus: () => boolean }).hasFocus;

        expect(hasFocus()).toBe(false);
        (panes[0].input as FocusEl).focus();
        expect(hasFocus()).toBe(true);
        r.panel!.focus();
        expect(hasFocus()).toBe(false);
        r.doc.root().createEl('input').focus();
        expect(hasFocus()).toBe(false);
    });

    it('tells the form once a create refused ends where the place asked again says the task cannot go', async () => {
        const r = rig();
        const facts = vi.fn(places.facts);
        const create = vi.fn(async (): Promise<WriteAnswer> => ({ written: false, refused: null }));
        await TaskHubPanel.openDraftHub(r.app, PLACE, {}, { ...r.deps, places: { ...places, facts, create } as unknown as CreatePlaces, notePlaces });
        const draft = (forms[0].host as PanelHost).draft()!;
        await Promise.resolve();
        await Promise.resolve();
        expect(draft.canWrite()).toBe(true);

        facts.mockResolvedValueOnce({
            kind: 'note', path: '2031-01-15.md', spot: { heading: 'Tasks', level: 2, side: 'head' },
            note: 'existing', seed: 'daily', heading: { kind: 'many', count: 2 }, ignored: false, inherits: {},
        });
        draft.write();
        for (let i = 0; i < 6; i++) await Promise.resolve();

        expect(draft.canWrite()).toBe(false);
        expect(forms[0].notWritten).toHaveBeenCalledTimes(1);
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
        const draft = (forms[0].host as PanelHost).draft()!;
        expect(facts).not.toHaveBeenCalled();
        expect(draft.canWrite()).toBe(false);

        host.reading();
        host.answered({ kind: 'to', to: { note: { kind: 'existing', path: '2031-01-15.md' }, spot: { heading: 'Tasks', level: 2, side: 'head' } } });
        await Promise.resolve();
        await Promise.resolve();

        expect(facts).toHaveBeenCalledWith(PLACE);
        expect(draft.canWrite()).toBe(true);
    });

    it('lets the form, and the place with it, go as it closes', async () => {
        const r = rig();
        await TaskHubPanel.openDraftHub(r.app, PLACE, {}, { ...r.deps, places, notePlaces });
        shells[0].close();
        expect(forms[0].dispose).toHaveBeenCalledTimes(1);
        expect(panes[0].dispose).toHaveBeenCalledTimes(1);
    });
});

describe('the hub on a row', () => {
    it('is titled as editing the task, above the body, the source\'s switch on the title\'s line after the title', async () => {
        const r = rig();
        await TaskHubPanel.openRowHub(r.app, makeTask({ id: 'task-1' }), r.deps);

        expect(body.head!.children.map(child => child.text)).toEqual([t('modal.hub.title'), '']);
        expect(body.head!.classes.has('task-hub__head')).toBe(true);
        expect(views[0].slots.toggle).toBe(body.head!.children[1]);
        expect([ja.modal.hub.title, en.modal.hub.title]).toEqual(['タスクを編集', 'Edit task']);
    });

    it('lays the form out with the card as the hub on a task not written yet does, handing it the place and the field it opens on', async () => {
        const r = rig();
        await TaskHubPanel.openRowHub(r.app, makeTask({ id: 'task-1' }), r.deps, { focusField: 'tags' });

        expect(r.body.classes.has('task-hub__body--tabs')).toBe(true);
        expect(forms[0].el).toBe(r.body.find('task-hub__form'));
        expect(handedOf(0)).toEqual({ place: expect.any(Function), opensOn: 'tags' });
    });

    it('has the form show where the row stands with no field: its note, and the heading once the note is read, with no reason the place cannot be changed', async () => {
        const r = rig();
        await TaskHubPanel.openRowHub(r.app, makeTask({ id: 'task-1' }), r.deps);
        const values = () => r.body.findAll('task-hub__shown-value').filter(el => el.parent?.style.display !== 'none').map(el => el.text);

        for (let i = 0; i < 5; i++) await Promise.resolve();
        expect(values()).toEqual(['note.md', t('modal.newTask.noHeading')]);
        expect(r.body.find('task-hub__shown')!.find('tv-form__says')).toBeNull();
        // The button that begins a move, on the note's row.
        expect(r.body.find('task-hub__shown')!.findAll('tv-form__row')[0].find('task-hub__move')!.attrs.get('aria-label')).toBe(t('menu.sendToNote'));
    });

    it('builds no form, and lays out no tabs, on a task that is read only', async () => {
        const r = rig();
        // The host follows the index's copy of the row.
        r.change(makeTask({ id: 'task-1', isReadOnly: true }));
        await TaskHubPanel.openRowHub(r.app, makeTask({ id: 'task-1', isReadOnly: true }), r.deps);

        expect(forms).toHaveLength(0);
        expect(r.body.classes.has('task-hub__body--tabs')).toBe(false);
        expect(r.body.find('task-hub__read-only-notice')!.text).toBe(t('modal.hub.readOnlyNotice'));
    });

    it('shows where a row that is read only stands under its notice, drawn again as the row changes, and lets it go as it closes', async () => {
        const r = rig();
        r.change(makeTask({ id: 'task-1', isReadOnly: true }));
        await TaskHubPanel.openRowHub(r.app, makeTask({ id: 'task-1', isReadOnly: true }), r.deps);
        const form = r.body.find('task-hub__form')!;
        const values = () => form.findAll('task-hub__shown-value').filter(el => el.parent?.style.display !== 'none').map(el => el.text);

        expect(form.children.map(child => [...child.classes][0])).toEqual(['task-hub__read-only-notice', 'tv-form__group']);
        for (let i = 0; i < 5; i++) await Promise.resolve();
        expect(values()).toEqual(['note.md', t('modal.newTask.noHeading')]);
        // A row read only is not moved from its hub.
        expect(form.find('task-hub__move')).toBeNull();

        r.change(undefined);
        expect(values()).toEqual(['', '']);
        shells[0].close();
    });

    it('builds the source mode on the row, in the panel\'s slots', async () => {
        const r = rig();
        await TaskHubPanel.openRowHub(r.app, makeTask({ id: 'task-1', content: '元の名前' }), r.deps);

        expect(sources).toHaveLength(1);
        expect((sources[0].host as SourceHost).seat().row()?.task).toMatchObject({ id: 'task-1', content: '元の名前' });
        // Why the source cannot open first, above the card: the body starts with no row of the switch's.
        const [shut, card, pane] = r.body.children;
        expect(views[0].slots).toMatchObject({ toggle: body.head!.children[1], shut, card, pane, foot: body.foot });
    });

    it('closes when a draft of the source is thrown away for a close', async () => {
        const r = rig();
        await TaskHubPanel.openRowHub(r.app, makeTask({ id: 'task-1' }), r.deps);
        const seat = (sources[0].host as SourceHost).seat() as SourceApply;
        const opening = SubtreeFrame.open(['- [ ] P'], '    ');
        if (!opening.open) throw new Error('the frame did not open');
        seat.opened({
            frame: opening.frame,
            editor: { draft: () => ({ parent: '- [ ] Q', children: [] }) } as never,
            say: () => { }, redraw: () => { }, asked: () => { }, focusEditor: () => { }, end: () => { },
        });

        expect(seat.beforeClose()).toBe(false);
        seat.discard();
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
        const seat = (sources[0].host as SourceHost).seat();
        sources[0].redraw.mockImplementation(() => { order.push(`source:${seat.row()?.task.content ?? 'none'}`); });
        (r.deps.taskRenderer.render as ReturnType<typeof vi.fn>).mockImplementation((_el: unknown, dt: Task) => { order.push(`card:${dt.content}`); });

        r.change(makeTask({ id: 'task-1', content: '外の名前' }));
        r.change(undefined);

        expect(order).toEqual(['card:外の名前', 'source:外の名前', 'source:none']);
    });

    it('lets the source mode open only once the writes the form asked are done', async () => {
        let release!: () => void;
        const r = rig(() => new Promise<WriteAnswer>(resolve => { release = () => resolve({ written: true }); }));
        await TaskHubPanel.openRowHub(r.app, makeTask({ id: 'task-1' }), r.deps);
        const host = forms[0].host as PanelHost;
        const seat = (sources[0].host as SourceHost).seat();

        void host.put({ content: '打った名前' });
        let drained = false;
        // No longer wanted once the writes are done: it goes no further than the wait.
        const waiting = seat.open(() => false).then(() => { drained = true; });
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

describe('the hub on a row in a move', () => {
    /** The row on the disk: its line, and the heading under it. */
    const LINES = ['- [ ] Test task @2026-03-11', '# 見出し', ''];
    const ROW = makeTask({ id: 'task-1', subtreeLines: [LINES[0]] });
    const PREVIEW: SendPreview = {
        rows: [{ task: ROW, lines: LINES }],
        defaults: { note: { text: 'Plan', picked: null }, section: { heading: 'Tasks', level: 2, side: 'head' } },
        candidates: [],
        links: [],
    };

    /** A rig whose row is read from the disk as `read` answers, the index holding the row as the disk does. */
    function moveRig(read: SendPreview | null = PREVIEW) {
        const noteOps = {
            previewSend: vi.fn(async () => read),
            // Where the fields name is never answered: the move offers no write meanwhile.
            destinationFacts: () => new Promise(() => { }),
            timersRefuse: () => null,
            send: vi.fn(),
        };
        const r = rig(undefined, noteOps);
        r.change(ROW);
        return { ...r, noteOps };
    }

    /** The card's menu as the hub hands it to the card it draws last. */
    const menuOf = (deps: TaskHubDeps) => {
        const calls = (deps.taskRenderer.render as ReturnType<typeof vi.fn>).mock.calls;
        return (calls.at(-1)![3] as { hooks: { menu: TaskMenuHooks } }).hooks.menu;
    };

    it('reads the row from the disk first, and opens in the move: the basic tab, the fields of where the row goes where a send goes, the focus on the note', async () => {
        const r = moveRig();
        await TaskHubPanel.openRowHub(r.app, makeTask({ id: 'task-1' }), r.deps, { move: 'defaults' });

        expect(r.noteOps.previewSend).toHaveBeenCalledWith(['task-1']);
        expect(handedOf(0).opensOn).toBe('place');
        expect((forms[0].host as PanelHost).draft()).not.toBeNull();
        expect(r.body.find('task-hub__shown')).toBeNull();
        const focus = shells[0].opts!.initialFocus!() as { to: FocusEl };
        expect(r.body.find('task-hub__place')!.contains(focus.to)).toBe(true);
        expect(focus.to.value).toBe('Plan');
        // The overlay puts that first focus: the host asks for none of its own.
        expect(forms[0].focusPlace).not.toHaveBeenCalled();
    });

    it('opens nothing on a row the disk does not hold as the index read it', async () => {
        const r = moveRig(null);
        await TaskHubPanel.openRowHub(r.app, makeTask({ id: 'task-1' }), r.deps, { move: 'defaults' });

        expect(shells).toHaveLength(0);
        expect(forms).toHaveLength(0);
    });

    it('thrown away, shows where the row stands again, the hub open', async () => {
        const r = moveRig();
        await TaskHubPanel.openRowHub(r.app, makeTask({ id: 'task-1' }), r.deps, { move: 'defaults' });

        (forms[0].host as PanelHost).draft()!.discard!();
        expect((forms[0].host as PanelHost).draft()).toBeNull();
        expect(r.body.find('task-hub__shown')).not.toBeNull();
        expect(shells[0].opts).not.toBeNull();
    });

    it('draws its card from the index out of a move, from the move\'s draft in it, and from the index again once it is thrown away', async () => {
        const r = moveRig();
        await TaskHubPanel.openRowHub(r.app, makeTask({ id: 'task-1' }), r.deps, { move: 'defaults' });
        const host = forms[0].host as PanelHost;
        const inMove = draws(r.deps).at(-1)!;
        expect(inMove.rows).toBeDefined();
        expect(inMove.rows!('task-1')).toEqual(host.task());

        host.draft()!.discard!();
        expect(draws(r.deps).at(-1)!.rows).toBeUndefined();
        expect(host.cardRows()).toBeNull();
    });

    it('has the card\'s menu move the row in this hub, where a send goes, and not again from a menu opened before it moved', async () => {
        const r = moveRig();
        await TaskHubPanel.openRowHub(r.app, makeTask({ id: 'task-1' }), r.deps);
        const host = forms[0].host as PanelHost;
        expect(host.draft()).toBeNull();

        menuOf(r.deps).onBeginMove!();
        await vi.waitFor(() => expect(host.draft()).not.toBeNull());
        expect(shells).toHaveLength(1);
        expect(r.body.find('task-hub__place')).not.toBeNull();
        const move = (host as unknown as { moving(): { initial: DestinationAsk } }).moving();
        expect(move.initial).toEqual({ note: { text: 'Plan', picked: null }, heading: 'Tasks' });
        // Once it is all drawn, the place's first field takes the focus, as from the place's button.
        expect(forms[0].focusPlace).toHaveBeenCalledTimes(1);

        // The card in the move is drawn from the draft, which binds no menu (`RenderOptions.rows`):
        // a menu opened on the card before the move was held is what can still ask.
        expect(draws(r.deps).at(-1)!.rows).toBeDefined();
        menuOf(r.deps).onBeginMove!();
        await Promise.resolve();
        expect(r.noteOps.previewSend).toHaveBeenCalledTimes(1);
    });

    it('a hub on a task not written yet hands its card\'s menu no move', async () => {
        const r = rig();
        await TaskHubPanel.openDraftHub(r.app, PLACE, {}, { ...r.deps, places, notePlaces });
        expect(menuOf(r.deps).onBeginMove).toBeUndefined();
    });
});
