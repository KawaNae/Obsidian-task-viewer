import { ItemView, type App, type Menu, type ViewStateResult, type WorkspaceLeaf } from 'obsidian';
import type { PluginContext } from '../../PluginContext';
import type { TimerHost } from '../../timer/TimerWidget';
import type { ViewConfigCodec } from '../../services/viewConfig/ViewConfigCodec';
import { readViewConfig } from '../../services/viewConfig/ConfigIssueNotice';
import { logDebug } from '../../log/log';
import { DateUtils } from '../../utils/DateUtils';
import { RenderScheduler } from '../sharedUI/RenderScheduler';
import type { ViewSettingsOptions } from '../sharedUI/ViewToolbar';
import { VIEW_DESCRIPTORS, viewDisplayName, type ViewDescriptor } from '../ViewDescriptors';
import { ViewStore } from './ViewStore';
import { buildViewSettingsOptions, configOf, transientOf, type NamedConfig, type ViewStateOf } from './ViewSettings';

/**
 * What a toolbar is handed: the view's store, which it reads, subscribes to
 * and writes, and the settings menu built for the view. A view's commands
 * that are not a change of its state (move by days, go to now) are handed
 * beside it, by the view's own toolbar type.
 */
export interface ViewToolbarHost<S extends object> {
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
 * Obsidian opens a view (`onOpen`) and then hands it its state (`setState`),
 * and may hand it a state again later (a URI opened over it). The base keeps
 * that order: `openView` builds the DOM, a draw before the state comes shows
 * the defaults, and `onReady` runs once when both have happened.
 *
 * The plugin's events: `redraw` (settings saved), `onDayRolled` (the visual
 * day changed) and `onMinute` (a minute passed). By default the first two
 * draw again and the last does nothing.
 */
export abstract class TaskViewerView<
    TConfig extends NamedConfig,
    TTransient extends object = Record<string, never>,
> extends ItemView {
    protected readonly descriptor: ViewDescriptor;
    protected readonly store: ViewStore<ViewStateOf<TConfig, TTransient>>;
    protected readonly renderScheduler: RenderScheduler;

    private opened = false;
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
            performFull: () => { if (this.opened) this.draw(); },
            getHost: () => this.contentEl,
        });
        this.store.subscribe(patch => this.answerChange(patch));
    }

    getViewType(): string {
        return this.descriptor.type;
    }

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
        await this.openView();
        this.opened = true;
        this.renderScheduler.scheduleRender();
        this.tryReady();
    }

    async onClose(): Promise<void> {
        logDebug(`[${this.getViewType()}] closed`);
        await this.closeView();
        this.renderScheduler.dispose();
    }

    /**
     * The workspace's state for this view: the config over the schema's
     * defaults (REPLACE — a field the state lacks goes back to its default),
     * and the transient fields the state holds, over the ones the view has.
     */
    async setState(state: unknown, result: ViewStateResult): Promise<void> {
        const dict = (state ?? {}) as Record<string, unknown>;
        const config = this.codec.withDefaults(readViewConfig(this.codec, dict));
        const transient = this.codec.parseTransient(dict);
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

    /** Settings were saved: draw again where the view is. */
    redraw(): void {
        this.requestDraw();
    }

    /** The visual day changed. A view that follows today moves to the new one. */
    onDayRolled(): void {
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
    protected toolbarHost(): ViewToolbarHost<ViewStateOf<TConfig, TTransient>> {
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

    /** Build the view's DOM and wire it; the first draw follows. */
    protected abstract openView(): void | Promise<void>;

    /** Let go of what `openView` took (subscriptions, observers, popovers). */
    protected closeView(): void | Promise<void> {}

    /** Draw the whole view from its state. Called by the scheduler, once the view is open. */
    protected abstract draw(): void;

    /** The view is open and has its state; runs once. */
    protected onReady(): void {}
}
