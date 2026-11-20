import { describe, it, expect, vi, afterEach } from 'vitest';
import { TaskHubPanel, type SourceMaker, type TaskHubDeps } from '../../../src/modals/hub/TaskHubPanel';
import type { HubPanel, PanelHost } from '../../../src/modals/hub/HubHost';
import type { SourceHost } from '../../../src/modals/hub/TaskHubSource';
import type { WriteAnswer } from '../../../src/services/operations/WriteAnswer';
import { DEFAULT_SETTINGS } from '../../../src/types/Settings';
import type { Task } from '../../../src/types';
import { makeTask } from '../helpers/makeTask';
import { FocusDoc, type FocusEl } from '../helpers/focusDom';

/**
 * The hub's panel as it joins its pieces: the card drawn again when the host
 * asks, the source mode built only when the opener gives it a way to, and,
 * on a row, the source mode following the row the host follows and waiting
 * for the host's writes. The overlay, the form, and the source mode's own
 * logic and surface stand in here; the host on a row is the real one, on a
 * stand-in index.
 */

const { shells, forms, sources, views } = vi.hoisted(() => ({
    shells: [] as { opts: { build(body: unknown): void; onClose?: () => void; beforeClose?: () => unknown } | null; close(): void }[],
    forms: [] as { host: unknown; beforeClose: ReturnType<typeof vi.fn> }[],
    sources: [] as { task: unknown; host: unknown; follow: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }[],
    views: [] as { bar: unknown; card: unknown; pane: unknown }[],
}));
const body = { current: null as FocusEl | null };

vi.mock('../../../src/views/sharedUI/OverlayShell', () => ({
    OverlayShell: class {
        opts: { build(body: unknown): void; onClose?: () => void } | null = null;
        constructor() { shells.push(this); }
        isOpen() { return this.opts !== null; }
        open(opts: { build(body: unknown): void; onClose?: () => void }) {
            this.opts = opts;
            opts.build(body.current);
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
        constructor(_el: unknown, readonly host: unknown) { forms.push(this); }
        fieldElement() { return null; }
        focusField() { }
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
        constructor(_app: unknown, readonly bar: unknown, readonly card: unknown, readonly pane: unknown) { views.push(this); }
    },
}));

afterEach(() => {
    for (const shell of shells) shell.close();
    shells.length = 0;
    forms.length = 0;
    sources.length = 0;
    views.length = 0;
});

/** A body to build in, and the panel's deps, the card's draws counted by the content each drew. */
function rig(updateTask: () => Promise<WriteAnswer> = async () => ({ written: true })) {
    const doc = new FocusDoc();
    body.current = doc.root();
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
    const app = { keymap: {} } as never;
    /** The index changes the row to `row`, and says so. */
    const change = (row: Task | undefined) => {
        copy = row;
        for (const listener of [...listeners]) listener('task-1');
    };
    return { body: body.current, deps, app, drawn, change, listeners };
}

/** A host that is only what the panel sees of one. */
function panelHost(task: Task): PanelHost & { panel: HubPanel | null; dispose: ReturnType<typeof vi.fn<() => void>> } {
    return {
        panel: null,
        task: () => task,
        put: async () => true,
        shut: () => null,
        openSource: () => { },
        closing: () => 'close',
        bind: () => { },
        attach(panel) { this.panel = panel; },
        dispose: vi.fn<() => void>(),
    };
}

describe('the hub panel', () => {
    it('draws the card again each time the host asks', async () => {
        const r = rig();
        let content = '一';
        const host = panelHost(makeTask({ id: 'task-1', content: '一' }));
        host.task = () => makeTask({ id: 'task-1', content });
        await new TaskHubPanel(r.app, host, r.deps, {}, null).open();

        content = '二';
        host.panel?.redrawPreview();
        expect(r.drawn).toEqual(['一', '二']);
    });

    it('builds no source mode, nor its switch, when it is given no way to', async () => {
        const r = rig();
        await new TaskHubPanel(r.app, panelHost(makeTask()), r.deps, {}, null).open();

        expect(r.body.children.map(child => [...child.classes].join(' '))).toEqual(['task-hub__preview', 'task-hub__form']);
        expect(forms).toHaveLength(1);
    });

    it('builds the source mode in its switch\'s bar above the card and its pane under it, once, and closes when it asks', async () => {
        const r = rig();
        const host = panelHost(makeTask());
        const made: Parameters<SourceMaker>[0][] = [];
        await new TaskHubPanel(r.app, host, r.deps, {}, (slots) => {
            made.push(slots);
            return { beforeClose: () => true, yieldsEscape: () => false, takesBack: () => false, dispose: vi.fn() };
        }).open();

        expect(made).toHaveLength(1);
        const [bar, card, pane] = r.body.children;
        expect(made[0]).toMatchObject({ bar, card, pane });
        expect(card.classes.has('task-hub__preview')).toBe(true);
        made[0].close();
        expect(host.dispose).toHaveBeenCalledTimes(1);
    });
});

describe('the hub on a row', () => {
    it('builds the source mode on the row, in the panel\'s slots', async () => {
        const r = rig();
        await TaskHubPanel.openRowHub(r.app, makeTask({ id: 'task-1', content: '元の名前' }), r.deps);

        expect(sources).toHaveLength(1);
        expect(sources[0].task).toMatchObject({ id: 'task-1', content: '元の名前' });
        const [bar, card, pane] = r.body.children;
        expect(views[0]).toMatchObject({ bar, card, pane });
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
