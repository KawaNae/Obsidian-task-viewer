import { ItemView, type App, type Menu, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import type { PluginContext } from '../../PluginContext';
import type { TimerHost } from '../../timer/TimerWidget';
import type { ViewConfigCodec } from '../../services/viewConfig/ViewConfigCodec';
import { readViewConfig } from '../../services/viewConfig/ConfigIssueNotice';
import { logDebug } from '../../log/log';
import { DateUtils } from '../../utils/DateUtils';
import { RenderScheduler } from '../sharedUI/RenderScheduler';
import { CardReconciler } from '../sharedUI/CardReconciler';
import type { ViewSettingsOptions, ViewToolbarBase } from '../sharedUI/ViewToolbar';
import type { ViewSidebar } from '../sidebar/ViewSidebar';
import type { TaskCardRenderer } from '../taskcard/TaskCardRenderer';
import { VIEW_DESCRIPTORS, viewDisplayName, type ViewDescriptor } from '../ViewDescriptors';
import { ViewStore } from './ViewStore';
import { buildViewSettingsOptions, configOf, transientOf, type NamedConfig, type ViewStateOf } from './ViewSettings';

/**
 * What a toolbar is handed: the view's store, which it reads, subscribes to
 * and writes, and the settings menu built for the view. A view's commands
 * that are not a change of its state (move by days, go to now) are handed
 * beside it, by the view's own toolbar type.
 */
export interface ViewToolbarContext<S extends object> {
    readonly app: App;
    readonly plugin: PluginContext;
    readonly store: ViewStore<S>;
    /** The gear menu's options; `appendCustomItems` puts the toolbar's own items above the shared block. */
    settingsOptions(appendCustomItems?: (menu: Menu) => void): ViewSettingsOptions;
}

/**
 * The base of the plugin's views.
 *
 * A view's state is the config and the transient fields of its schema, held
 * as one value in a {@link ViewStore}. It changes only through the store, and
 * the base answers every change in one place:
 *
 * - the view is drawn once, in the next frame (`RenderScheduler`);
 * - the layout is saved when the patch holds a field of the schema — unless
 *   the change is the workspace's own (`setState`);
 * - the tab is retitled when the name changed.
 *
 * Toolbars and the pinned lists subscribe to the store and mend themselves.
 *
 * The base builds the view's frame once, as it opens: the toolbar's place
 * (`tv-view__toolbar-host`) and the body, the one element the view draws
 * into. The body is the sidebar's main area for a view with a sidebar
 * (`ViewSidebar`), else `tv-view__body`. No draw takes either out of the
 * document. Each draw runs the same steps here (`drawFrame`): the toolbar is
 * brought up to the state, the view reads what the emptying would lose, the
 * cards in the body are gathered and the body emptied, the view draws the
 * body, and the cards it did not take again are disposed of.
 *
 * Obsidian opens a view (`onOpen`) and then hands it its state (`setState`),
 * and may hand it a state again later (a URI opened over it). The base keeps
 * that order: `openView` wires the view's parts, a draw before the state
 * comes shows the defaults, and `onReady` runs once when both have happened.
 *
 * The plugin's events: `redraw` (settings saved), `onDayRolled` (the visual
 * day changed) and `onMinute` (a minute passed). The first two are answered
 * here, for every view: the view's own answer (`settingsSaved`,
 * `dayRolled`), then a draw. Saved settings are also handed to the
 * sidebar, between the two; a new day is not. The last does nothing unless
 * the view says otherwise.
 */
export abstract class TaskViewerView<
    TConfig extends NamedConfig,
    TTransient extends object = Record<never, never>,
> extends ItemView {
    protected readonly descriptor: ViewDescriptor;
    protected readonly store: ViewStore<ViewStateOf<TConfig, TTransient>>;
    protected readonly renderScheduler: RenderScheduler;

    private opened = false;
    /** The element the view draws into; made once as the view opens. */
    private body: HTMLElement | null = null;
    /** The view's toolbar, put in its place as the view opens. */
    private placedToolbar: ViewToolbarBase | null = null;
    /** The view's sidebar, built as the view opens. */
    private openedSidebar: ViewSidebar | null = null;
    private unsubscribeIndex: (() => void) | null = null;
    private stateApplied = false;
    private readied = false;
    /** A change made by `setState`: the workspace's own state, not one to save back. */
    private restoring = false;
    /** A change the view has shown itself (a zoom gesture, the sidebar's slide): no draw. */
    private drawShown = false;

    constructor(
        leaf: WorkspaceLeaf,
        protected readonly plugin: PluginContext & TimerHost,
        protected readonly codec: ViewConfigCodec<TConfig, TTransient>,
    ) {
        super(leaf);
        this.descriptor = VIEW_DESCRIPTORS[codec.schema.viewType];
        this.store = new ViewStore(codec.withDefaults({}) as ViewStateOf<TConfig, TTransient>);
        this.renderScheduler = new RenderScheduler({
            performFull: () => { if (this.opened) this.drawFrame(); },
            getHost: () => this.contentEl,
        });
        this.store.subscribe(patch => this.answerChange(patch));
    }

    /**
     * The view's type, answered by each view from its schema module.
     * Obsidian's View constructor reads it (the leaf's `data-type`) before
     * this class has its fields, so it cannot be read from the codec the
     * view hands the base.
     */
    abstract getViewType(): string;

    getDisplayText(): string {
        return this.store.get().customName || viewDisplayName(this.descriptor.type);
    }

    getIcon(): string {
        return this.descriptor.icon;
    }

    /** The view's state now. */
    protected get state(): Readonly<ViewStateOf<TConfig, TTransient>> {
        return this.store.get();
    }

    /**
     * Change the view's state. With `{ draw: false }` the view has already
     * shown the change itself, and only the save and the listeners follow.
     */
    protected update(patch: Partial<ViewStateOf<TConfig, TTransient>>, options?: { draw?: boolean }): void {
        this.drawShown = options?.draw === false;
        try {
            this.store.update(patch);
        } finally {
            this.drawShown = false;
        }
    }

    private answerChange(patch: Partial<ViewStateOf<TConfig, TTransient>>): void {
        if (!this.drawShown) this.renderScheduler.scheduleRender();
        if (!this.restoring && this.holdsSchemaField(patch)) {
            this.app.workspace.requestSaveLayout();
        }
        if ('customName' in patch) this.leaf.updateHeader();
    }

    private holdsSchemaField(patch: object): boolean {
        const { config, transient } = this.codec.schema;
        return Object.keys(patch).some(key => key in config || key in transient);
    }

    // ==================== Lifecycle ====================

    async onOpen(): Promise<void> {
        logDebug(`[${this.getViewType()}] opened`);
        const container = this.contentEl;
        container.empty();
        // Where the toolbar stands, above the body.
        const toolbarSlot = container.createDiv('tv-view__toolbar-host');
        const sidebar = this.frameSidebar();
        this.openedSidebar = sidebar;
        this.body = sidebar
            ? sidebar.build(container, (el, ev, handler) => this.registerDomEvent(el, ev, handler))
            : container.createDiv('tv-view__body');
        await this.openView();
        const toolbar = this.frameToolbar();
        toolbar.place(toolbarSlot);
        this.placedToolbar = toolbar;
        if (this.followsIndex()) {
            this.unsubscribeIndex = this.plugin.getIndex().onChange((taskId, changes) => {
                this.indexChanged();
                this.renderScheduler.handleChange(taskId, changes);
            });
        }
        this.opened = true;
        this.renderScheduler.scheduleRender();
        this.tryReady();
    }

    async onClose(): Promise<void> {
        logDebug(`[${this.getViewType()}] closed`);
        this.unsubscribeIndex?.();
        this.unsubscribeIndex = null;
        await this.closeView();
        this.placedToolbar?.close();
        this.openedSidebar?.close();
        this.renderScheduler.dispose();
    }

    /**
     * Draw the view: the toolbar brought up to the state, the body emptied
     * and drawn by the view, keeping the cards the view takes again.
     */
    private drawFrame(): void {
        const body = this.body;
        if (!body) return;
        this.placedToolbar?.sync();
        this.beforeEmpty();
        const renderer = this.cardRenderer();
        const cards = new CardReconciler();
        if (renderer) cards.detach(body);
        body.empty();
        this.draw(body, cards);
        // Their elements are out of the document already (`detach`).
        if (renderer) cards.forEachStale(card => renderer.dispose(card));
    }

    /**
     * The workspace's state for this view: the config over the schema's
     * defaults (REPLACE — a field the state lacks goes back to its default),
     * and the transient fields the state holds, over the ones the view has
     * (where the view is is set whole: `ViewConfigCodec.transientOfState`).
     */
    async setState(state: unknown, result: ViewStateResult): Promise<void> {
        const dict = (state ?? {}) as Record<string, unknown>;
        const config = this.codec.withDefaults(readViewConfig(this.codec, dict));
        const transient = this.codec.transientOfState(dict);
        this.restoring = true;
        try {
            this.store.update({ ...config, ...transient } as ViewStateOf<TConfig, TTransient>);
        } finally {
            this.restoring = false;
        }
        await super.setState(state, result);
        this.stateApplied = true;
        this.tryReady();
    }

    getState(): Record<string, unknown> {
        const state = this.store.get();
        return {
            ...this.codec.serializeConfig(configOf<TConfig>(state)),
            ...this.codec.serializeTransient(transientOf<TTransient>(state)),
        };
    }

    private tryReady(): void {
        if (this.readied || !this.opened || !this.stateApplied) return;
        this.readied = true;
        this.onReady();
    }

    /**
     * Settings were saved: the view answers (`settingsSaved`), the sidebar's
     * frames read their notes again, and the view is drawn again. Views
     * answer in `settingsSaved`, not here.
     */
    redraw(): void {
        this.settingsSaved();
        this.openedSidebar?.settingsSaved();
        this.requestDraw();
    }

    /**
     * The visual day changed: the view answers (`dayRolled`) and is drawn
     * again. Views answer in `dayRolled`, not here.
     */
    onDayRolled(): void {
        this.dayRolled();
        this.requestDraw();
    }

    /** A minute passed. A view that draws the time of day moves its now-line. */
    onMinute(): void {}

    // ==================== For the views ====================

    /** Draw in the next frame (a change of the tasks, of the settings). */
    protected requestDraw(): void {
        this.renderScheduler.scheduleRender();
    }

    /** Today, as the views count days: the visual day (`startHour`). */
    protected visualToday(): string {
        return DateUtils.getVisualDateOfNow(this.plugin.settings.startHour);
    }

    /** What the view's toolbar is handed. */
    protected toolbarContext(): ViewToolbarContext<ViewStateOf<TConfig, TTransient>> {
        return {
            app: this.app,
            plugin: this.plugin,
            store: this.store,
            settingsOptions: (appendCustomItems) => buildViewSettingsOptions({
                app: this.app,
                leaf: this.leaf,
                plugin: this.plugin,
                descriptor: this.descriptor,
                codec: this.codec,
                store: this.store,
            }, appendCustomItems),
        };
    }

    // ==================== What the view answers ====================

    /**
     * Wire the view's parts, once, as it opens: the frame is built by then,
     * and the toolbar is put in its place and the first draw follows.
     */
    protected abstract openView(): void | Promise<void>;

    /**
     * Let go of what `openView` took (subscriptions, observers, popovers).
     * The toolbar and the sidebar are closed after it.
     */
    protected closeView(): void | Promise<void> {}

    /** The view's toolbar; the view has it by the end of `openView`. */
    protected abstract frameToolbar(): ViewToolbarBase;

    /**
     * The view's sidebar, when it has one: it builds its layout in the
     * frame, and its main area is the body. Asked from `onOpen`, before
     * `openView`.
     */
    protected frameSidebar(): ViewSidebar | null {
        return null;
    }

    /**
     * What the view draws its cards with, which disposes of the cards a draw
     * did not take again. A view that draws no cards answers null.
     */
    protected abstract cardRenderer(): TaskCardRenderer | null;

    /** Whether the view draws again when the index changes. */
    protected followsIndex(): boolean {
        return true;
    }

    /** The index changed; the draw it sets off is asked for after this. */
    protected indexChanged(): void {}

    /** Read what emptying the body loses (the scroll), before each draw. */
    protected beforeEmpty(): void {}

    /**
     * Draw the body, emptied, from the view's state. The cards gathered from
     * it are in `cards`, to be taken again. Called by the scheduler, once
     * the view is open.
     */
    protected abstract draw(body: HTMLElement, cards: CardReconciler): void;

    /** The view's answer to the settings saved, before it is drawn again. */
    protected settingsSaved(): void {}

    /** The view's answer to the visual day's change, before it is drawn again. */
    protected dayRolled(): void {}

    /** The view is open and has its state; runs once. */
    protected onReady(): void {}
}
