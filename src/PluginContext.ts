import type { App, PluginManifest } from 'obsidian';
import type { TaskViewerSettings } from './types';
import type { TaskIndex } from './services/core/TaskIndex';
import type { TaskReadService } from './services/data/TaskReadService';
import type { TaskWriteService } from './services/data/TaskWriteService';
import type { MenuPresenter } from './interaction/menu/MenuPresenter';
import type { LogManager } from './log/log-manager';

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

    getTaskIndex(): TaskIndex;
    getTaskReadService(): TaskReadService;
    getTaskWriteService(): TaskWriteService;
    getLogManager(): LogManager | null;

    /** Re-apply the body classes that the global-style settings drive. */
    updateGlobalStyles(): void;
    /** Tell the editor's inline task menu that its settings moved. */
    notifyEditorMenuSettingsChanged(): void;
}
