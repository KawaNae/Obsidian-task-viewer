import { apiVersion, Notice, Platform, Plugin, TFile, type View, type WorkspaceLeaf } from 'obsidian';
import { TaskIndex, type IndexReads } from './services/core/TaskIndex';
import { TimelineView } from './views/timelineview';
import { ScheduleView } from './views/scheduleview';
import { CalendarView, MiniCalendarView } from './views/calendar';
import { KanbanView } from './views/kanban';
import { TimerView } from './views/TimerView';
import { TimerWidget } from './timer/TimerWidget';
import {
    type TaskViewerSettings,
    DEFAULT_SETTINGS,
    DEFAULT_SCOPE_KEYS,
    normalizeScopeKeys,
    validateScopeKeys,
} from './types';
import type { Task } from './types';
import { TaskViewerSettingTab } from './settings';
import { ColorSuggest } from './suggest/color/ColorSuggest';
import { LineStyleSuggest } from './suggest/line/LineStyleSuggest';
import { PropertySuggestObserver } from './suggest/PropertySuggestObserver';
import { DateUtils } from './utils/DateUtils';
import { untrackAllKeyboards } from './utils/KeyboardState';
import { registerWeekStartLocales } from './utils/momentWeekLocale';
import { AudioUtils } from './timer/AudioUtils';
import { TASK_VIEWER_HOVER_SOURCE_DISPLAY, TASK_VIEWER_HOVER_SOURCE_ID } from './constants/hover';
import { ALL_VIEWS, isViewType, viewTypesWhere, type ViewType } from './views/ViewDescriptors';
import { openLeafFromState } from './services/viewConfig/LeafOpener';
import { openViewFromUri } from './services/viewConfig/UriViewOpener';
import { PropertiesMenuBuilder } from './interaction/menu/builders/PropertiesMenuBuilder';
import { PropertyCalculator } from './interaction/menu/PropertyCalculator';
import { PropertyFormatter } from './interaction/menu/PropertyFormatter';
import { TimerMenuBuilder } from './interaction/menu/builders/TimerMenuBuilder';
import { TaskActionsMenuBuilder } from './interaction/menu/builders/TaskActionsMenuBuilder';
import { CheckboxMenuBuilder } from './interaction/menu/builders/CheckboxMenuBuilder';
import { ValidationMenuBuilder } from './interaction/menu/builders/ValidationMenuBuilder';
import { MenuPresenter } from './interaction/menu/MenuPresenter';
import { createCardRendering, type CardRendering } from './views/sharedUI/CardRendering';
import { TaskViewHoverParent } from './views/taskcard/TaskViewHoverParent';
import { closeAllOverlays } from './views/sharedUI/OverlayRegistry';
import { OverdueWatcher } from './services/display/OverdueWatcher';
import type { TaskHubPanelOptions } from './modals/hub/TaskHubPanel';
import { createTaskMenuExtension } from './editor/TaskMenuExtension';
import { createDiagnosticsExtension } from './editor/DiagnosticsExtension';
import { fireFilter } from './editor/FlowFireExtension';
import { createGenBlockPreview } from './editor/GenBlockPreview';
import { GEN_LANGUAGE_TAG } from './services/parsing/gen/GenBlockCollector';
import { registerCliHandlers } from './cli/CliRegistrar';
import { TaskApi } from './api/TaskApi';
import { ExportService } from './services/export/ExportService';
import { TaskReadService } from './services/data/TaskReadService';
import { Operations } from './services/operations/Operations';
import { NoteOps } from './services/data/NoteOps';
import { initI18n, t } from './i18n';
import { enabledLineParserIds } from './services/parsing/TaskParser';
import { initLog, logInfo } from './log/log';
import { LogStorage } from './log/log-storage';
import { LogManager } from './log/log-manager';
import { LogView, VIEW_TYPE_LOG } from './views/logview/LogView';
import type { DeviceInfo } from './log/markdown-formatter';
import { ViewEvents } from './views/sharedLogic/ViewEvents';
import { applyBodyStyles, clearBodyStyles } from './settings/BodyStyles';
import { deviceMemoryGb, jsHeapStats, nodeOs } from './utils/hostEnv';

/**
 * The constructor of each view. The table (`VIEW_DESCRIPTORS`) cannot hold
 * them without importing the view classes, which import the table; keyed by
 * `ViewType`, a view left out here is a compile error.
 */
const VIEW_CONSTRUCTORS: Record<ViewType, (leaf: WorkspaceLeaf, plugin: TaskViewerPlugin) => View> = {
    'timeline-view': (leaf, plugin) => new TimelineView(leaf, plugin),
    'schedule-view': (leaf, plugin) => new ScheduleView(leaf, plugin),
    'timer-view': (leaf, plugin) => new TimerView(leaf, plugin),
    'calendar-view': (leaf, plugin) => new CalendarView(leaf, plugin),
    'mini-calendar-view': (leaf, plugin) => new MiniCalendarView(leaf, plugin),
    'kanban-view': (leaf, plugin) => new KanbanView(leaf, plugin),
};

export default class TaskViewerPlugin extends Plugin {
    private taskIndex: TaskIndex;
    private readService: TaskReadService;
    private operations: Operations;
    private noteOps: NoteOps;
    private timerWidget: TimerWidget;
    private logStorage: LogStorage;
    private logManager: LogManager;
    public settings: TaskViewerSettings;
    public api: TaskApi;
    public exportService: ExportService;
    public menuPresenter: MenuPresenter;

    // Settings-changed and day-rolled events to the open views that hear them
    private viewEvents = new ViewEvents(
        () => viewTypesWhere(d => d.hearsEvents)
            .flatMap(viewType => this.app.workspace.getLeavesOfType(viewType).map(leaf => leaf.view)),
        () => DateUtils.getVisualDateOfNow(this.settings.startHour),
    );
    private dateCheckInterval: ReturnType<typeof setInterval> | null = null;

    // Overdue watch (clock-driven, see startOverdueWatch)
    private overdueWatcher = new OverdueWatcher();
    private overdueAlignTimeout: ReturnType<typeof setTimeout> | null = null;
    private overdueInterval: ReturnType<typeof setInterval> | null = null;

    // Properties View color/linestyle suggest observer
    private propertySuggestObserver: PropertySuggestObserver | null = null;

    // Editor inline menu button
    private taskMenuCleanup: (() => void) | null = null;
    private taskMenuNotifySettingsChanged: (() => void) | null = null;

    // ビュー外コンテキスト（editor ··· menu / file-menu）からタスクハブ
    // モーダルを開くための共有インスタンス（lazy 生成）
    private hubHoverParent = new TaskViewHoverParent();
    /** The cards of a hub opened outside the views, made with the first. */
    private hubCards: CardRendering | null = null;

    async onload() {

        // Initialize i18n
        initI18n();

        // Register custom moment locales so weekStartDay drives all week-aware
        // moment computations (filename / label / week number) regardless of
        // the user's Obsidian locale firstDayOfWeek.
        registerWeekStartLocales();

        // Load Settings
        await this.loadSettings();

        // Initialize logging subsystem
        initLog(
            () => this.settings,
            (msg, dur) => new Notice(`Task Viewer: ${msg}`, dur),
        );

        // Initialize Services
        this.taskIndex = new TaskIndex(this.app, this.settings, { isOwnView: isViewType });
        await this.taskIndex.initialize();

        // Initialize persistent log storage
        const vaultName = this.app.vault.getName();
        this.logStorage = new LogStorage(vaultName);
        await this.logStorage.ensureSchemaVersion();
        this.logManager = new LogManager({
            storage: this.logStorage,
            getSettings: () => this.settings,
            getPluginVersion: () => this.manifest.version,
            getObsidianVersion: () => apiVersion,
            getPlatform: () => ({
                os: this.deriveOsLabel(),
                isMobile: Platform.isMobile,
            }),
            getTaskDiagnostics: () => ({
                taskCount: this.taskIndex.getTasks().length,
                activeViewCount: this.countActiveViews(),
                enabledParsers: this.getEnabledParsers(),
                startHour: this.settings.startHour,
            }),
            getDeviceInfo: () => this.collectDeviceInfo(),
            vault: {
                exists: (p) => this.app.vault.adapter.exists(p),
                createBinary: async (p, d) => { await this.app.vault.createBinary(p, d); },
            },
            doc: typeof document !== 'undefined' ? document : undefined,
            win: typeof window !== 'undefined' ? window : undefined,
        });
        this.readService = new TaskReadService(this.taskIndex, () => this.settings);
        this.operations = new Operations(this.app, this.taskIndex);
        // The timer widget is made below; a send asks for it as it is made.
        this.noteOps = new NoteOps(this.app, this.operations, () => this.settings, {
            getTask: (id) => this.taskIndex.getTask(id),
            timers: () => this.timerWidget ?? null,
        });

        // Single source of truth for menu lifecycle (dedup across all views/touch paths).
        this.menuPresenter = new MenuPresenter();

        // Public API (plugin interop / DataviewJS)
        this.api = new TaskApi(this);
        this.exportService = new ExportService(this);

        // Register CLI handlers
        registerCliHandlers(this);

        // Initialize Timer Widget. Construction is cheap (no DOM ops, no
        // storage read). Window observer attach + restore happens in
        // onLayoutReady below so the active window is known.
        this.timerWidget = new TimerWidget(this.app, this);

        this.app.workspace.onLayoutReady(() => {
            this.timerWidget?.activate();
            this.logManager.start();
            const built = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : 'unknown';
            logInfo(`Task Viewer v${this.manifest.version} starting — built ${built}`);
        });

        this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
            if (!(file instanceof TFile) || file.extension !== 'md') return;
            this.timerWidget?.handleFileRename(oldPath, file.path);
        }));

        // Register View
        this.registerHoverLinkSource(TASK_VIEWER_HOVER_SOURCE_ID, {
            display: TASK_VIEWER_HOVER_SOURCE_DISPLAY,
            defaultMod: false,
        });

        // Each view: its constructor, a ribbon icon and a command, from the table
        for (const view of ALL_VIEWS) {
            this.registerView(view.type, (leaf) => VIEW_CONSTRUCTORS[view.type](leaf, this));
            this.addRibbonIcon(view.icon, t(view.ribbonTitleKey), () => {
                void this.activateView(view.type);
            });
            this.addCommand({
                id: view.commandId,
                name: t(view.commandNameKey),
                callback: () => {
                    void this.activateView(view.type);
                },
            });
        }

        this.registerView(
            VIEW_TYPE_LOG,
            (leaf) => new LogView(leaf)
        );

        this.addCommand({
            id: 'open-log-view',
            name: t('command.openLog'),
            callback: () => {
                this.activateLogView();
            }
        });

        // Register Settings Tab
        this.addSettingTab(new TaskViewerSettingTab(this.app, this));

        // Register Editor Suggest
        this.registerEditorSuggest(new ColorSuggest(this.app, this));
        this.registerEditorSuggest(new LineStyleSuggest(this.app, this));

        // Menu builders for inline task menu button
        const editorPropertiesBuilder = new PropertiesMenuBuilder(
            this.app, this.operations, this,
            new PropertyCalculator(), new PropertyFormatter()
        );
        const editorTimerBuilder = new TimerMenuBuilder(this);
        const editorActionsBuilder = new TaskActionsMenuBuilder(this.app, this.operations, this);
        const editorValidationBuilder = new ValidationMenuBuilder();
        const editorCheckboxBuilder = new CheckboxMenuBuilder(
            this.app,
            () => this.settings.startHour,
        );

        // Register inline menu button on checkbox lines (CM6 extension)
        const taskMenuResult = createTaskMenuExtension(
            this.app,
            this.taskIndex,
            this.operations.editorLineHost(),
            editorPropertiesBuilder,
            editorTimerBuilder,
            editorActionsBuilder,
            editorCheckboxBuilder,
            editorValidationBuilder,
            this.menuPresenter,
            () => this.settings,
            (taskId, opts) => this.openTaskHub(taskId, opts)
        );
        this.registerEditorExtension(taskMenuResult.extension);
        this.taskMenuCleanup = taskMenuResult.cleanup;
        this.taskMenuNotifySettingsChanged = taskMenuResult.notifySettingsChanged;

        // A completion made in the editor fires its flow in the transaction
        // that made it; nothing else in the editor fires.
        this.registerEditorExtension(fireFilter(this.operations.editorFireHost()));

        // Wavy-underline diagnostics for `==>` flow commands and `@date`
        // blocks. Pure re-parse of visible lines — no TaskIndex.
        this.registerEditorExtension(createDiagnosticsExtension(() => this.settings));

        // Reading-view rendering of `tv-gen` blocks. Also the only place a
        // Live Preview user sees their diagnostics: Obsidian replaces a
        // closed fence with this widget, and the editor underlines go with it.
        this.registerMarkdownCodeBlockProcessor(GEN_LANGUAGE_TAG, createGenBlockPreview());

        // Body classes and root variables the settings drive
        applyBodyStyles(this.settings);

        // Start day boundary check (every 5 minutes)
        this.startDateBoundaryCheck();
        this.startOverdueWatch();

        // Start Properties View color suggest observer
        this.propertySuggestObserver = new PropertySuggestObserver(
            this.app,
            () => this.settings,
            this
        );
        this.propertySuggestObserver.start();

        // obsidian://task-viewer?view=<shortName>&template=<name>&...
        // The road from a URI to an open view lives in UriViewOpener.
        this.registerObsidianProtocolHandler('task-viewer', (params) => {
            void openViewFromUri(this.app, this.settings, params);
        });
    }

    async loadSettings() {
        const raw = await this.loadData();
        const rawObject = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};

        const merged = Object.assign({}, DEFAULT_SETTINGS, rawObject) as TaskViewerSettings;
        const normalizedKeys = normalizeScopeKeys(merged.scopeKeys);
        const keysValidationError = validateScopeKeys(normalizedKeys);

        this.settings = {
            ...merged,
            scopeKeys: keysValidationError
                ? { ...DEFAULT_SCOPE_KEYS }
                : normalizedKeys,
        };
    }

    async saveSettings() {
        logInfo(`[saveSettings] startHour=${this.settings.startHour} parsers=[${this.getEnabledParsers()}]`);
        await this.saveData(this.settings);
        this.taskIndex.updateSettings(this.settings);
        // Reconfigure editor extensions so diagnostics pick up the rebuilt
        // parser chain immediately (dp/tp toggles change line ownership).
        this.app.workspace.updateOptions();
        applyBodyStyles(this.settings);

        this.viewEvents.settingsChanged();
    }

    notifyEditorMenuSettingsChanged() {
        this.taskMenuNotifySettingsChanged?.();
    }

    /**
     * ビュー外コンテキスト（editor ··· menu / file-menu）からタスクハブ
     * モーダルを開く。ビュー内はビュー自身の openTaskHub を通る。どちらも
     * renderer、MenuHandler、ハブを createCardRendering で組む。
     */
    openTaskHub(taskId: string, options?: TaskHubPanelOptions): void {
        const task = this.taskIndex.getTask(taskId);
        if (!task) return;

        if (!this.hubCards) {
            this.hubCards = createCardRendering({
                app: this.app,
                plugin: this,
                getHoverParent: () => this.hubHoverParent,
                getMaskMode: () => false,
            });
            this.addChild(this.hubCards.taskRenderer);
        }
        this.hubCards.openTaskHub(task, options);
    }

    // Public accessors for services
    getIndex(): IndexReads {
        return this.taskIndex;
    }

    getTaskReadService(): TaskReadService {
        return this.readService;
    }

    getOperations(): Operations {
        return this.operations;
    }

    getNoteOps(): NoteOps {
        return this.noteOps;
    }

    getTimerWidget(): TimerWidget {
        return this.timerWidget;
    }

    /**
     * Turn the passage of time into a render, but only when it changed
     * something.
     *
     * A card that crosses its end or due moves no task field, so no vault
     * event fires and its content signature still matches — the overdue icon
     * would not appear until the task was edited. The sweep re-judges every
     * task and notifies once when any of them moved; the signature then
     * redraws exactly the cards whose judgement changed.
     *
     * The notification is a full invalidation on purpose: a span names one
     * task, and a tick can move several. It carries no field list because
     * NotifyCoalescer drops one without a task id anyway.
     *
     * The first tick lands on the next minute boundary so a card turns
     * overdue within a second of the minute it belongs to, not up to a
     * minute later.
     */
    private startOverdueWatch(): void {
        const sweep = () => {
            const changed = this.overdueWatcher.sweep(
                this.readService.getAllDisplayTasks(),
                this.settings.startHour,
                this.settings.statusDefinitions,
                this.readService,
            );
            if (changed) this.taskIndex.notifyImmediate();
        };

        const msToNextMinute = 60000 - (Date.now() % 60000);
        this.overdueAlignTimeout = setTimeout(() => {
            this.overdueAlignTimeout = null;
            sweep();
            this.overdueInterval = setInterval(sweep, 60000);
        }, msToNextMinute);
    }

    /**
     * Start checking for day boundary changes every 5 minutes
     */
    private startDateBoundaryCheck(): void {
        this.viewEvents.watch();

        // Check every 5 minutes
        this.dateCheckInterval = setInterval(() => {
            this.viewEvents.rollIfChanged();
        }, 5 * 60 * 1000); // 5 minutes
    }

    /** Open a view via ribbon / command. No state seeding — view uses its own defaults. */
    async activateView(viewType: string): Promise<void> {
        await openLeafFromState(this.app, this.settings, viewType, undefined, {});
    }

    onunload() {
        // Root-level overlays sit on document.body and outlive the plugin.
        // Close them before the services they hold go away (#165).
        closeAllOverlays();
        this.logManager?.stop();
        this.logStorage?.close();
        this.taskMenuCleanup?.();
        untrackAllKeyboards();
        this.operations?.dispose();
        this.taskIndex?.dispose();
        AudioUtils.dispose();
        clearBodyStyles();
        this.timerWidget?.destroy();

        // Clear day boundary check interval
        if (this.dateCheckInterval) {
            clearInterval(this.dateCheckInterval);
            this.dateCheckInterval = null;
        }

        // Clear the overdue watch (alignment timeout may still be pending)
        if (this.overdueAlignTimeout) {
            clearTimeout(this.overdueAlignTimeout);
            this.overdueAlignTimeout = null;
        }
        if (this.overdueInterval) {
            clearInterval(this.overdueInterval);
            this.overdueInterval = null;
        }

        // Disconnect Properties color suggest observer
        this.propertySuggestObserver?.destroy();
        this.propertySuggestObserver = null;
    }

    // ── Logging helpers ────────────────────────────────────

    getLogManager(): LogManager | null {
        return this.logManager ?? null;
    }

    private async activateLogView(): Promise<void> {
        const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_LOG);
        if (existing.length > 0) {
            this.app.workspace.revealLeaf(existing[0]);
            return;
        }
        const leaf = this.app.workspace.getRightLeaf(false);
        if (leaf) {
            await leaf.setViewState({ type: VIEW_TYPE_LOG, active: true });
            this.app.workspace.revealLeaf(leaf);
        }
    }

    private deriveOsLabel(): string {
        if (typeof process !== 'undefined' && process.platform) return process.platform;
        const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
        if (Platform.isAndroidApp) {
            const m = /Android (\d+(?:\.\d+)?)/.exec(ua);
            return m ? `android ${m[1]}` : 'android';
        }
        if (Platform.isIosApp) {
            const base = Platform.isTablet ? 'ipados' : 'ios';
            const m = /OS (\d+(?:_\d+)*)/.exec(ua);
            return m ? `${base} ${m[1].replace(/_/g, '.')}` : base;
        }
        return 'unknown';
    }

    private collectDeviceInfo(): DeviceInfo {
        const d: DeviceInfo = {};
        try {
            if (typeof navigator !== 'undefined') {
                if (typeof navigator.hardwareConcurrency === 'number') {
                    d.cpuCores = navigator.hardwareConcurrency;
                }
                if (navigator.userAgent) d.userAgent = navigator.userAgent;
                const dm = deviceMemoryGb();
                if (dm !== undefined) d.deviceMemoryGb = dm;
            }
        } catch { /* best effort */ }
        try {
            const pm = jsHeapStats();
            if (pm) {
                if (typeof pm.usedJSHeapSize === 'number') {
                    d.jsHeapUsedMb = Math.round(pm.usedJSHeapSize / 1048576);
                }
                if (typeof pm.jsHeapSizeLimit === 'number') {
                    d.jsHeapLimitMb = Math.round(pm.jsHeapSizeLimit / 1048576);
                }
            }
        } catch { /* best effort */ }
        try {
            const os = nodeOs();
            if (os) {
                d.arch = os.arch();
                d.osRelease = os.release();
                const cpus = os.cpus();
                if (cpus?.length) {
                    d.cpuCores = cpus.length;
                    const model = (cpus[0]?.model ?? '').trim();
                    if (model) d.cpuModel = model;
                }
                d.totalRamGb = Math.round((os.totalmem() / 1073741824) * 10) / 10;
                d.freeRamGb = Math.round((os.freemem() / 1073741824) * 10) / 10;
            }
        } catch { /* best effort */ }
        return d;
    }

    private countActiveViews(): number {
        let count = 0;
        for (const vt of viewTypesWhere(d => d.countsAsActive)) {
            count += this.app.workspace.getLeavesOfType(vt).length;
        }
        return count;
    }

    /** The task sources currently active, for the diagnostics report. */
    private getEnabledParsers(): string[] {
        return [...enabledLineParserIds(this.settings)];
    }

}
