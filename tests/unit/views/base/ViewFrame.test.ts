import { describe, it, expect } from 'vitest';
import type { WorkspaceLeaf } from 'obsidian';
import { TaskViewerView } from '../../../../src/views/base/TaskViewerView';
import { TimerCodec, type TimerConfig } from '../../../../src/views/TimerSchema';
import type { CardReconciler } from '../../../../src/views/sharedUI/CardReconciler';
import type { ViewToolbarBase } from '../../../../src/views/sharedUI/ViewToolbar';
import type { ViewSidebar } from '../../../../src/views/sidebar/ViewSidebar';
import type { TaskCardRenderer } from '../../../../src/views/taskcard/TaskCardRenderer';
import { holdCard } from '../../../../src/views/taskcard/CardHold';
import type { DisplayTask } from '../../../../src/types';

/**
 * The base builds a view's frame once, as the view opens, and runs the
 * steps of every draw; a view answers the base's questions and draws its
 * body. These tests read the order of those steps and which elements they
 * touch, with a small view on the base whose answers write a log.
 *
 * The view is opened as Obsidian opens one: `onOpen`, then `setState`. Its
 * draws wait for a frame of the window its content is in, driven here by
 * hand (`tick`).
 */

/** The window of the view's content: a frame clock driven by hand. */
function frameClock() {
    let nextId = 1;
    const pending = new Map<number, () => void>();
    const win = {
        requestAnimationFrame(cb: () => void): number {
            const id = nextId++;
            pending.set(id, cb);
            return id;
        },
        cancelAnimationFrame(id: number): void {
            pending.delete(id);
        },
    };
    return {
        win,
        /** Run the frames queued now. */
        tick(): void {
            const due = [...pending.values()];
            pending.clear();
            due.forEach(cb => cb());
        },
        pending: () => pending.size,
    };
}

/**
 * An element of a stand-in DOM: what the base, the reconciler and the test
 * view touch. A card is found by the reconciler's selector
 * (`.task-card[data-card-scope]`).
 */
class El {
    readonly children: El[] = [];
    parent: El | null = null;
    readonly classes: Set<string>;
    readonly dataset: Record<string, string> = {};
    readonly nodeType = 1;
    readonly classList = { remove: (...cls: string[]) => cls.forEach(c => this.classes.delete(c)) };

    constructor(cls: string, readonly ownerDocument: { defaultView: unknown }) {
        this.classes = new Set(cls.split(/\s+/).filter(Boolean));
    }

    createDiv(o: string | { cls?: string } = {}): El {
        const el = new El(typeof o === 'string' ? o : o.cls ?? '', this.ownerDocument);
        this.appendChild(el);
        return el;
    }
    appendChild(el: El): void {
        el.remove();
        el.parent = this;
        this.children.push(el);
    }
    remove(): void {
        if (!this.parent) return;
        this.parent.children.splice(this.parent.children.indexOf(this), 1);
        this.parent = null;
    }
    empty(): void {
        [...this.children].forEach(c => c.remove());
    }
    /** The descendants that are cards with a place; the only selector the reconciler asks. */
    querySelectorAll(selector: string): El[] {
        expect(selector).toBe('.task-card[data-card-scope]');
        return this.descendants().filter(el => el.classes.has('task-card') && 'cardScope' in el.dataset);
    }
    descendants(): El[] {
        return this.children.flatMap(c => [c, ...c.descendants()]);
    }
    /** The first descendant with the class `cls`. */
    find(cls: string): El | null {
        return this.descendants().find(el => el.classes.has(cls)) ?? null;
    }
    /** Whether `el` is this element or inside it. */
    holds(el: El): boolean {
        for (let at: El | null = el; at; at = at.parent) if (at === this) return true;
        return false;
    }
}

const asEl = (el: El) => el as unknown as HTMLElement;

function taskOf(name: string): DisplayTask {
    return { id: name, file: 'a.md', statusChar: ' ', content: name } as DisplayTask;
}

/** A card the view drew in `parent`, as `TaskCardRenderer.render` leaves one. */
function drawCard(parent: El, name: string): El {
    const card = parent.createDiv('task-card');
    card.dataset.cardScope = 'lane';
    card.dataset.cardName = name;
    card.dataset.name = name;
    holdCard(asEl(card), taskOf(name), { scope: 'lane', name }, []);
    return card;
}

interface Options {
    sidebar?: boolean;
    cards?: boolean;
    followsIndex?: boolean;
    /** The names of the cards the view takes again at a draw. */
    takes?: string[];
}

/** A view on the base whose every answer writes the log. */
class FrameView extends TaskViewerView<TimerConfig> {
    drawnBody: El | null = null;
    cardsHanded: CardReconciler | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: never, private readonly parts: {
        log: string[];
        root: El;
        options: Options;
        toolbar: ViewToolbarBase;
        sidebar: ViewSidebar | null;
        renderer: TaskCardRenderer | null;
        /** How many frames are queued now. */
        pending: () => number;
    }) {
        super(leaf, plugin, TimerCodec);
    }

    getViewType(): string {
        return TimerCodec.schema.viewType;
    }

    /** What the frame holds now, as the view sees it. */
    private frame(): string {
        const { root } = this.parts;
        const slot = root.find('tv-view__toolbar-host');
        const body = root.find('tv-view__body') ?? root.find('tv-sidebar__main');
        return `slot=${slot !== null} body=${body !== null} toolbar=${root.find('view-toolbar') !== null}`;
    }

    protected frameSidebar(): ViewSidebar | null {
        this.parts.log.push(`frameSidebar ${this.frame()}`);
        return this.parts.sidebar;
    }
    protected openView(): void {
        this.parts.log.push(`openView ${this.frame()}`);
    }
    protected closeView(): void {
        this.parts.log.push('closeView');
    }
    protected frameToolbar(): ViewToolbarBase {
        return this.parts.toolbar;
    }
    protected cardRenderer(): TaskCardRenderer | null {
        return this.parts.renderer;
    }
    protected followsIndex(): boolean {
        return this.parts.options.followsIndex ?? true;
    }
    protected indexChanged(): void {
        this.parts.log.push(`indexChanged pending=${this.parts.pending()}`);
    }
    protected beforeEmpty(): void {
        const body = this.parts.root.find('tv-view__body') ?? this.parts.root.find('tv-sidebar__main');
        this.parts.log.push(`beforeEmpty cards=${body?.querySelectorAll('.task-card[data-card-scope]').length}`);
    }
    protected draw(body: HTMLElement, cards: CardReconciler): void {
        const el = body as unknown as El;
        this.drawnBody = el;
        this.cardsHanded = cards;
        this.parts.log.push(`draw children=${el.children.length} waiting=${cards.pendingCount}`);
        for (const name of this.parts.options.takes ?? []) {
            const card = cards.acquire({ scope: 'lane', name }, taskOf(name)) as unknown as El | undefined;
            el.appendChild(card ?? drawCard(el, name));
        }
    }
    protected settingsSaved(): void {
        this.parts.log.push(`settingsSaved pending=${this.parts.pending()}`);
    }
    protected dayRolled(): void {
        this.parts.log.push(`dayRolled pending=${this.parts.pending()}`);
    }
    protected onReady(): void {
        this.parts.log.push('onReady');
    }
}

/**
 * A view built with `options`, its toolbar, sidebar, renderer and index
 * writing the log. `open` opens it as Obsidian does.
 */
function setup(options: Options = {}) {
    const log: string[] = [];
    const clock = frameClock();
    const root = new El('view-content', { defaultView: clock.win });

    let placedRoot: El | null = null;
    const toolbar = {
        place(slot: HTMLElement) {
            const at = slot as unknown as El;
            log.push(`toolbar.place into=${[...at.classes].join('.')}`);
            placedRoot = at.createDiv('view-toolbar');
        },
        sync() { log.push('toolbar.sync'); },
        close() { log.push('toolbar.close'); },
    } as unknown as ViewToolbarBase;

    let panel: El | null = null;
    const sidebar = options.sidebar ? {
        build(container: HTMLElement) {
            log.push('sidebar.build');
            const layout = (container as unknown as El).createDiv({ cls: 'tv-sidebar' });
            const main = layout.createDiv({ cls: 'tv-sidebar__main' });
            panel = layout.createDiv({ cls: 'tv-sidebar__panel' });
            return asEl(main);
        },
        settingsSaved() { log.push('sidebar.settingsSaved'); },
        close() { log.push('sidebar.close'); },
    } as unknown as ViewSidebar : null;

    const disposed: string[] = [];
    const renderer = (options.cards ?? true) ? {
        dispose(card: HTMLElement) {
            const name = (card as unknown as El).dataset.name;
            disposed.push(name);
            log.push(`dispose ${name}`);
        },
    } as unknown as TaskCardRenderer : null;

    const listeners: ((taskId?: string, changes?: string[]) => void)[] = [];
    const plugin = {
        settings: { startHour: 0 },
        getIndex: () => ({
            onChange(listener: (taskId?: string, changes?: string[]) => void) {
                log.push('index.subscribe');
                listeners.push(listener);
                return () => {
                    log.push('index.unsubscribe');
                    listeners.splice(listeners.indexOf(listener), 1);
                };
            },
        }),
    } as never;

    const leaf = { updateHeader() {} } as unknown as WorkspaceLeaf;
    const view = new FrameView(leaf, plugin, { log, root, options, toolbar, sidebar, renderer, pending: clock.pending });
    view.contentEl = asEl(root);
    view.app.workspace = { requestSaveLayout() {} } as never;

    return {
        view, log, root, clock, disposed, listeners,
        panel: () => panel,
        placedRoot: () => placedRoot,
        async open(): Promise<void> {
            await view.onOpen();
            await view.setState({}, { history: false });
        },
        /** The log from here on. */
        fresh(): string[] {
            log.length = 0;
            return log;
        },
    };
}

describe('a view opening', () => {
    it('puts the toolbar\'s place first, wires the view in the built frame, then places the toolbar, follows the index and draws in the next frame', async () => {
        const t = setup();
        await t.open();

        expect(t.log).toEqual([
            'frameSidebar slot=true body=false toolbar=false',
            'openView slot=true body=true toolbar=false',
            'toolbar.place into=tv-view__toolbar-host',
            'index.subscribe',
            'onReady',
        ]);
        expect(t.clock.pending()).toBe(1);

        t.clock.tick();
        expect(t.log.slice(5)).toEqual(['toolbar.sync', 'beforeEmpty cards=0', 'draw children=0 waiting=0']);
    });

    it('without a sidebar, makes the body `tv-view__body`, after the toolbar\'s place', async () => {
        const t = setup();
        await t.open();
        t.clock.tick();

        expect(t.root.children.map(c => [...c.classes].join('.'))).toEqual(['tv-view__toolbar-host', 'tv-view__body']);
        expect(t.view.drawnBody).toBe(t.root.children[1]);
        expect(t.root.children[0].holds(t.placedRoot()!)).toBe(true);
    });

    it('with a sidebar, has the sidebar build its layout after the toolbar\'s place and draws in the sidebar\'s main area', async () => {
        const t = setup({ sidebar: true });
        await t.open();
        t.clock.tick();

        expect(t.log.slice(0, 3)).toEqual([
            'frameSidebar slot=true body=false toolbar=false',
            'sidebar.build',
            'openView slot=true body=true toolbar=false',
        ]);
        expect(t.root.children.map(c => [...c.classes].join('.'))).toEqual(['tv-view__toolbar-host', 'tv-sidebar']);
        expect(t.root.find('tv-view__body')).toBeNull();
        expect(t.view.drawnBody).toBe(t.root.find('tv-sidebar__main'));
    });

    it('does not follow the index when the view says not to', async () => {
        const t = setup({ followsIndex: false });
        await t.open();

        expect(t.log).not.toContain('index.subscribe');
        expect(t.listeners).toHaveLength(0);
    });
});

describe('a draw', () => {
    it('brings the toolbar up, lets the view read the body, gathers its cards and empties it, has the view draw, then disposes of the cards it did not take', async () => {
        const t = setup({ takes: ['a'] });
        await t.open();
        t.clock.tick();
        // The first draw drew `a`; `b` is a card no draw takes again.
        const body = t.view.drawnBody!;
        const a = body.children[0];
        drawCard(body, 'b');

        const log = t.fresh();
        t.view.redraw();
        t.clock.tick();

        expect(log).toEqual([
            'settingsSaved pending=0',
            'toolbar.sync',
            'beforeEmpty cards=2',
            'draw children=0 waiting=2',
            'dispose b',
        ]);
        expect(body.children).toEqual([a]);
    });

    it('gathers the cards of the body alone: a card in the sidebar\'s panel is neither gathered nor disposed of', async () => {
        const t = setup({ sidebar: true });
        await t.open();
        t.clock.tick();
        drawCard(t.view.drawnBody!, 'in-body');
        const inPanel = drawCard(t.panel()!, 'in-panel');

        const log = t.fresh();
        t.view.redraw();
        t.clock.tick();

        expect(log).toContain('draw children=0 waiting=1');
        expect(t.disposed).toEqual(['in-body']);
        expect(t.panel()!.children).toEqual([inPanel]);
    });

    it('keeps the toolbar\'s place, the toolbar and the body in the frame', async () => {
        const t = setup();
        await t.open();
        t.clock.tick();
        const [slot, body] = t.root.children;
        const toolbar = t.placedRoot();

        t.view.redraw();
        t.clock.tick();

        expect(t.root.children).toEqual([slot, body]);
        expect(slot.children).toEqual([toolbar]);
        expect(t.view.drawnBody).toBe(body);
    });

    it('for a view that draws no cards, gathers none and disposes of none', async () => {
        const t = setup({ cards: false });
        await t.open();
        t.clock.tick();
        drawCard(t.view.drawnBody!, 'a');

        const log = t.fresh();
        t.view.redraw();
        t.clock.tick();

        expect(log).toContain('draw children=0 waiting=0');
        expect(log.some(line => line.startsWith('dispose'))).toBe(false);
    });

    it('does not run before the view is open', () => {
        const t = setup();
        t.view.redraw();
        t.clock.tick();

        expect(t.log).toEqual(['settingsSaved pending=0']);
    });
});

describe('the plugin\'s events', () => {
    it('a change of the index: the view hears it first, and a draw is asked for after', async () => {
        const t = setup();
        await t.open();
        t.clock.tick();

        const log = t.fresh();
        t.listeners[0]('a', ['content']);
        expect(log).toEqual(['indexChanged pending=0']);
        expect(t.clock.pending()).toBe(1);

        t.clock.tick();
        expect(log).toContain('toolbar.sync');
    });

    it('settings saved: the view answers, then the sidebar, then the view is drawn', async () => {
        const t = setup({ sidebar: true });
        await t.open();
        t.clock.tick();

        const log = t.fresh();
        t.view.redraw();
        expect(log).toEqual(['settingsSaved pending=0', 'sidebar.settingsSaved']);
        expect(t.clock.pending()).toBe(1);

        t.clock.tick();
        expect(log.slice(2, 3)).toEqual(['toolbar.sync']);
    });

    it('the day rolled: the view answers and is drawn; the sidebar is not told', async () => {
        const t = setup({ sidebar: true });
        await t.open();
        t.clock.tick();

        const log = t.fresh();
        t.view.onDayRolled();
        expect(log).toEqual(['dayRolled pending=0']);
        expect(t.clock.pending()).toBe(1);

        t.clock.tick();
        expect(log.filter(line => line.startsWith('sidebar.'))).toEqual([]);
        expect(log).toContain('toolbar.sync');
    });
});

describe('a view closing', () => {
    it('stops following the index, lets the view let go, then closes the toolbar and the sidebar', async () => {
        const t = setup({ sidebar: true });
        await t.open();
        t.clock.tick();

        const log = t.fresh();
        await t.view.onClose();

        expect(log).toEqual(['index.unsubscribe', 'closeView', 'toolbar.close', 'sidebar.close']);
        expect(t.listeners).toHaveLength(0);
    });

    it('drops a draw asked for and not yet run', async () => {
        const t = setup();
        await t.open();
        t.clock.tick();
        t.view.onDayRolled();

        const log = t.fresh();
        await t.view.onClose();
        t.clock.tick();

        expect(log).not.toContain('toolbar.sync');
    });
});
