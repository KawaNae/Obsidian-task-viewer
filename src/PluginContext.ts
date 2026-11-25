import type { App, Component, Plugin, PluginManifest } from 'obsidian';
import type { TaskViewerSettings } from './types';
import type { IndexReads } from './services/core/TaskIndex';
import type { TaskReadService } from './services/data/TaskReadService';
import type { Operations } from './services/operations/Operations';
import type { NoteOps } from './services/data/NoteOps';
import type { NotePlaces } from './services/data/NotePlaces';
import type { CreatePlace, CreatePlaces } from './services/data/CreatePlaces';
import type { DraftSeed } from './services/data/TaskDraft';
import type { TaskHubPanelOptions } from './modals/hub/TaskHubPanel';
import type { MenuPresenter } from './interaction/menu/MenuPresenter';
import type { LogManager } from './log/log-manager';

/**
 * Ties a subscription to the plugin's lifetime.
 *
 * `registerEvent` is `Component`'s, not the plugin's own: it is about how long
 * a listener lives, not about what a module may read. Asking for the whole
 * `Plugin` to get it would hand the module `addCommand` and `loadData` too —
 * the same undeclared appetite this file exists to end.
 */
export type EventRegistrar = Pick<Component, 'registerEvent'>;

/** Registers a command with Obsidian's CLI. Narrow for the same reason. */
export type CliRegistrar = Pick<Plugin, 'registerCliHandler'>;

/**
 * What a feature module is allowed to want from the plugin.
 *
 * Nearly every module in `src` takes the plugin object, and takes it as the
 * concrete `TaskViewerPlugin` class, because that is the only type there was.
 * Two things follow from that. Every one of those modules closes an import
 * cycle back to `main.ts` — harmless at runtime, since the import is
 * type-only, but it makes `main.ts` the gravitational centre of the file
 * graph. And no module states what it actually needs, so "while I'm here, I'll
 * also read `plugin.x`" is invisible in review.
 *
 * The second is the reason for this file. Counted across the codebase, no
 * module reaches for more than four members of the plugin, and the great
 * majority want `settings` and little else. Narrowing the declared type to
 * this interface costs a module one import line and one annotation, and buys
 * a written record of its appetite.
 *
 * Membership rule: a member belongs here only if its type does not import
 * `main.ts` back. `api`, `exportService` and `getTimerWidget()` fail that
 * test — `TaskApi`, `ExportService` and `TimerWidget` each take the plugin
 * themselves — so putting them here would move the cycle rather than close
 * it. Those get their own small host interface, declared beside the thing
 * they hand out, and a module that needs one asks for the intersection:
 * `ctx: PluginContext & TimerHost`.
 *
 * `TaskViewerPlugin` satisfies this structurally, so main.ts declares nothing
 * and changes nothing.
 */
export interface PluginContext {
    readonly app: App;
    readonly manifest: PluginManifest;

    /**
     * Live settings, not a snapshot — settings tabs write fields in place and
     * then call {@link saveSettings}, so this cannot be readonly.
     */
    settings: TaskViewerSettings;
    saveSettings(): Promise<void>;

    readonly menuPresenter: MenuPresenter;

    /** The index as the read side sees it: its copies, its changes, the drag's hold. It writes nothing. */
    getIndex(): IndexReads;
    /** The display side of the read: DisplayTasks, date ranges, filters and sorts (`TaskReadService`). */
    getTaskReadService(): TaskReadService;
    /** The operations on the notes: the one way to write (`Operations`). */
    getOperations(): Operations;
    /** What the note and heading a destination's fields name are, read off the vault alone (`NotePlaces`): a send's and a task's to create. */
    getNotePlaces(): NotePlaces;
    /** The operations on notes: sending rows to a note (`NoteOps`). */
    getNoteOps(): NoteOps;
    /** The places a new task line is made in: what one is, and the write there (`CreatePlaces`). */
    getCreatePlaces(): CreatePlaces;
    getLogManager(): LogManager | null;

    /**
     * Open the hub on the row `taskId`, from outside the views: no selection
     * to clear and no mask. Nothing opens when the index no longer has it.
     */
    openTaskHub(taskId: string, options?: TaskHubPanelOptions): void;

    /**
     * Open the hub on a task not written yet, to be put in `place`, holding
     * `seed`'s values: nothing is written until it is created there. Null
     * for a note the user chooses in the hub's note field. The one way in for
     * every place a task is made from, a view's or the editor's.
     */
    openDraftHub(place: CreatePlace | null, seed: DraftSeed): void;

    /** Tell the editor's inline task menu that its settings moved. */
    notifyEditorMenuSettingsChanged(): void;
}
