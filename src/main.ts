import { apiVersion, Notice, Platform, Plugin, type Workspace, type WorkspaceLeaf, TFile } from 'obsidian';
import { TaskIndex } from './services/core/TaskIndex';
import { TimelineView, VIEW_TYPE_TIMELINE } from './views/timelineview';
import { ScheduleView, VIEW_TYPE_SCHEDULE } from './views/scheduleview';
import { CalendarView, VIEW_TYPE_CALENDAR, MiniCalendarView, VIEW_TYPE_MINI_CALENDAR } from './views/calendar';
import { KanbanView, VIEW_TYPE_KANBAN } from './views/kanban';
import { TimerView, VIEW_TYPE_TIMER } from './views/TimerView';
import { TimerWidget } from './timer/TimerWidget';
import { createTempTask } from './services/data/createTempTask';
import {
    type TaskViewerSettings,
    DEFAULT_SETTINGS,
    DEFAULT_TV_FILE_KEYS,
    normalizeTvFileKeys,
    validateTvFileKeys,
} from './types';
import type { DefaultLeafPosition, Task } from './types';
import { isTvFile } from './types';
import { TaskViewerSettingTab } from './settings';
import { ColorSuggest } from './suggest/color/ColorSuggest';
import { LineStyleSuggest } from './suggest/line/LineStyleSuggest';
import { PropertySuggestObserver } from './suggest/PropertySuggestObserver';
import { DateUtils } from './utils/DateUtils';
import { untrackAllKeyboards } from './utils/KeyboardState';
import { registerWeekStartLocales } from './utils/momentWeekLocale';
import { AudioUtils } from './timer/AudioUtils';
import { TASK_VIEWER_HOVER_SOURCE_DISPLAY, TASK_VIEWER_HOVER_SOURCE_ID } from './constants/hover';
import { getViewMeta } from './constants/viewRegistry';
import { ViewTemplateLoader } from './services/template/ViewTemplateLoader';
import { codecFor, resolveViewTypeFromShortName } from './services/viewConfig';
import { migrateAstronomySettings } from './services/settings/migration';
import { PropertiesMenuBuilder } from './interaction/menu/builders/PropertiesMenuBuilder';
import { PropertyCalculator } from './interaction/menu/PropertyCalculator';
import { PropertyFormatter } from './interaction/menu/PropertyFormatter';
import { TimerMenuBuilder } from './interaction/menu/builders/TimerMenuBuilder';
import { TaskActionsMenuBuilder } from './interaction/menu/builders/TaskActionsMenuBuilder';
import { CheckboxMenuBuilder } from './interaction/menu/builders/CheckboxMenuBuilder';
import { ValidationMenuBuilder } from './interaction/menu/builders/ValidationMenuBuilder';
import { MenuPresenter } from './interaction/menu/MenuPresenter';
import { MenuHandler } from './interaction/menu/MenuHandler';
import { TaskCardRenderer } from './views/taskcard/TaskCardRenderer';
import { TaskViewHoverParent } from './views/taskcard/TaskViewHoverParent';
import { TaskHubPanel, type TaskHubPanelOptions } from './modals/hub/TaskHubPanel';
import { createTaskMenuExtension } from './editor/TaskMenuExtension';
import { createDiagnosticsExtension } from './editor/DiagnosticsExtension';
import { toDisplayTask } from './services/display/DisplayTaskConverter';
import { registerCliHandlers } from './cli/CliRegistrar';
import { TaskApi } from './api/TaskApi';
import { TaskReadService } from './services/data/TaskReadService';
import { TaskWriteService } from './services/data/TaskWriteService';
import { initI18n, t } from './i18n';
import { TaskParser } from './services/parsing/TaskParser';
import { initLog, logInfo } from './log/log';
import { LogStorage } from './log/log-storage';
import { LogManager } from './log/log-manager';
import { LogView, VIEW_TYPE_LOG } from './views/logview/LogView';
import type { DeviceInfo } from './log/markdown-formatter';

export default class TaskViewerPlugin extends Plugin {
    private taskIndex: TaskIndex;
    private readService: TaskReadService;
    private writeService: TaskWriteService;
    private timerWidget: TimerWidget;
    private logStorage: LogStorage;
    private logManager: LogManager;
    public settings: TaskViewerSettings;
    public api: TaskApi;
    public menuPresenter: MenuPresenter;

    // Day boundary check
    private lastVisualDate: string = '';
    private dateCheckInterval: ReturnType<typeof setInterval> | null = null;

    // Properties View color/linestyle suggest observer
    private propertySuggestObserver: PropertySuggestObserver | null = null;

    // Editor inline menu button
    private taskMenuCleanup: (() => void) | null = null;
    private taskMenuNotifySettingsChanged: (() => void) | null = null;

    // ビュー外コンテキスト（editor ··· menu / file-menu）からタスクハブ
    // モーダルを開くための共有インスタンス（lazy 生成）
    private hubHoverParent = new TaskViewHoverParent();
    private hubTaskRenderer: TaskCardRenderer | null = null;
    private hubMenuHandler: MenuHandler | null = null;

    async onload() {

        // Initialize i18n
        initI18n();

        // Register custom moment locales so weekStartDay drives all week-aware
        // moment computations (filename / label / week number) regardless of
        // the user's Obsidian locale firstDayOfWeek.
        registerWeekStartLocales();

        // Load Settings
        await this.loadSettings();
        TaskParser.rebuildChain(this.settings);

        // Initialize logging subsystem
        initLog(
            () => this.settings,
            (msg, dur) => new Notice(`Task Viewer: ${msg}`, dur),
        );

        // Initialize Services
        this.taskIndex = new TaskIndex(this.app, this.settings);
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
        this.readService = new TaskReadService(this.taskIndex, this.settings.startHour);
        this.writeService = new TaskWriteService(this.taskIndex);

        // Single source of truth for menu lifecycle (dedup across all views/touch paths).
        this.menuPresenter = new MenuPresenter();

        // Public API (plugin interop / DataviewJS)
        this.api = new TaskApi(this);

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

        this.registerView(
            VIEW_TYPE_TIMELINE,
            (leaf) => new TimelineView(leaf, this)
        );

        this.registerView(
            VIEW_TYPE_SCHEDULE,
            (leaf) => new ScheduleView(leaf, this)
        );

        this.registerView(
            VIEW_TYPE_TIMER,
            (leaf) => new TimerView(leaf, this)
        );

        this.registerView(
            VIEW_TYPE_CALENDAR,
            (leaf) => new CalendarView(leaf, this)
        );

        this.registerView(
            VIEW_TYPE_MINI_CALENDAR,
            (leaf) => new MiniCalendarView(leaf, this)
        );

        this.registerView(
            VIEW_TYPE_KANBAN,
            (leaf) => new KanbanView(leaf, this)
        );

        this.registerView(
            VIEW_TYPE_LOG,
            (leaf) => new LogView(leaf)
        );

        const timelineViewMeta = getViewMeta(VIEW_TYPE_TIMELINE);
        const scheduleViewMeta = getViewMeta(VIEW_TYPE_SCHEDULE);
        const timerViewMeta = getViewMeta(VIEW_TYPE_TIMER);
        const calendarViewMeta = getViewMeta(VIEW_TYPE_CALENDAR);
        const miniCalendarViewMeta = getViewMeta(VIEW_TYPE_MINI_CALENDAR);
        const kanbanViewMeta = getViewMeta(VIEW_TYPE_KANBAN);

        // Add Ribbon Icon
        this.addRibbonIcon(timelineViewMeta.icon, timelineViewMeta.ribbonTitle, () => {
            this.activateView(VIEW_TYPE_TIMELINE);
        });

        this.addRibbonIcon(scheduleViewMeta.icon, scheduleViewMeta.ribbonTitle, () => {
            this.activateView(VIEW_TYPE_SCHEDULE);
        });

        this.addRibbonIcon(timerViewMeta.icon, timerViewMeta.ribbonTitle, () => {
            this.activateView(VIEW_TYPE_TIMER);
        });

        this.addRibbonIcon(calendarViewMeta.icon, calendarViewMeta.ribbonTitle, () => {
            this.activateView(VIEW_TYPE_CALENDAR);
        });

        this.addRibbonIcon(miniCalendarViewMeta.icon, miniCalendarViewMeta.ribbonTitle, () => {
            this.activateView(VIEW_TYPE_MINI_CALENDAR);
        });

        this.addRibbonIcon(kanbanViewMeta.icon, kanbanViewMeta.ribbonTitle, () => {
            this.activateView(VIEW_TYPE_KANBAN);
        });

        // Add Command
        this.addCommand({
            id: 'open-timeline-view',
            name: timelineViewMeta.commandName,
            callback: () => {
                this.activateView(VIEW_TYPE_TIMELINE);
            }
        });

        this.addCommand({
            id: 'open-schedule-view',
            name: scheduleViewMeta.commandName,
            callback: () => {
                this.activateView(VIEW_TYPE_SCHEDULE);
            }
        });

        this.addCommand({
            id: 'open-timer-view',
            name: timerViewMeta.commandName,
            callback: () => {
                this.activateView(VIEW_TYPE_TIMER);
            }
        });

        this.addCommand({
            id: 'open-calendar-view',
            name: calendarViewMeta.commandName,
            callback: () => {
                this.activateView(VIEW_TYPE_CALENDAR);
            }
        });

        this.addCommand({
            id: 'open-mini-calendar-view',
            name: miniCalendarViewMeta.commandName,
            callback: () => {
                this.activateView(VIEW_TYPE_MINI_CALENDAR);
            }
        });

        this.addCommand({
            id: 'open-kanban-view',
            name: kanbanViewMeta.commandName,
            callback: () => {
                this.activateView(VIEW_TYPE_KANBAN);
            }
        });

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
            this.app, this.writeService, this,
            new PropertyCalculator(), new PropertyFormatter()
        );
        const editorTimerBuilder = new TimerMenuBuilder(this);
        const editorActionsBuilder = new TaskActionsMenuBuilder(this.app, this.writeService, this);
        const editorValidationBuilder = new ValidationMenuBuilder();
        const editorCheckboxBuilder = new CheckboxMenuBuilder(
            this.app,
            () => this.settings.startHour,
            async (result, statusChar) => {
                const repository = this.getTaskRepository();
                const tempTask = createTempTask({
                    id: 'convert-temp',
                    content: result.content,
                    statusChar,
                    startDate: result.startDate,
                    startTime: result.startTime,
                    // endDate が省略されていて endTime がある場合、startDate から同日推論
                    endDate: result.endDate || (result.endTime && result.startDate ? result.startDate : undefined),
                    endTime: result.endTime,
                    due: result.due,
                });
                return await repository.createTvFile(
                    tempTask,
                    this.settings.tvFileChildHeader,
                    this.settings.tvFileChildHeaderLevel,
                    undefined,
                    undefined,
                    this.settings.tvFileKeys
                );
            }
        );

        // Register inline menu button on checkbox lines (CM6 extension)
        const taskMenuResult = createTaskMenuExtension(
            this.app,
            this.readService,
            this.writeService,
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

        // Wavy-underline diagnostics for `==>` flow commands and `@date`
        // blocks. Pure re-parse of visible lines — no TaskIndex.
        this.registerEditorExtension(createDiagnosticsExtension());

        // File context menu integration for frontmatter tasks.
        // Frontmatter tasks have no inline anchor in the editor body (file menu is the only entry point),
        // so we surface the full task menu via Obsidian's file-menu (file explorer / tab / pane).
        this.registerEvent(
            this.app.workspace.on('file-menu', (menu, file) => {
                if (!this.settings.fileMenuForTvFile) return;
                if (!(file instanceof TFile)) return;

                const task = this.taskIndex.getTasks().find(t =>
                    t.file === file.path && isTvFile(t)
                );
                if (!task) return;

                menu.addSeparator();
                editorValidationBuilder.addValidationWarning(menu, task);
                const dt = toDisplayTask(task, this.settings.startHour, (id) => this.taskIndex.getTask(id));
                // G1: 自身のデータ操作
                editorPropertiesBuilder.addStatusSubmenu(menu, task);
                editorActionsBuilder.addOwnDataActions(menu, task);
                editorPropertiesBuilder.buildPropertiesSubmenu(menu, dt, null,
                    (field) => this.openTaskHub(task.id, { focusField: field }));
                menu.addSeparator();
                // G2: 自身を記録
                editorTimerBuilder.addTrackSelfItems(menu, task);
                menu.addSeparator();
                // G3: 子のデータ操作
                editorActionsBuilder.addChildActions(menu, task);
                menu.addSeparator();
                // G4: 複製
                editorActionsBuilder.addDuplicateActions(menu, task);
                menu.addSeparator();
                // G5: 破壊的変更
                editorActionsBuilder.addDestructiveActions(menu, task);
            })
        );

        // Apply global styles if enabled
        this.updateGlobalStyles();
        this.updateViewHeaderStyles();

        // Start day boundary check (every 5 minutes)
        this.startDateBoundaryCheck();

        // Start Properties View color suggest observer
        this.propertySuggestObserver = new PropertySuggestObserver(
            this.app,
            () => this.settings,
            this
        );
        this.propertySuggestObserver.start();

        // Register URI handler: obsidian://task-viewer?view=<shortName>&template=<name>&...
        //
        // After the ViewConfigSchema refactor the handler is uniform across all
        // views: per-view differences live in the schema, not here. The handler
        // role shrinks to (1) resolve view type, (2) load template (if any),
        // (3) overlay URI-query overrides, (4) re-serialize through codec into
        // canonical state dict, (5) hand to openLeafFromState. Adding a new
        // persisted field requires zero changes in this function.
        this.registerObsidianProtocolHandler('task-viewer', (params) => {
            void (async () => {
                const viewType = resolveViewTypeFromShortName(params.view) ?? this.resolveLegacyViewShortName(params.view);
                if (!viewType) return;

                const position = this.parseUriPosition(params.position);

                if (viewType === VIEW_TYPE_TIMER) {
                    await this.openTimerFromUri(params, position);
                    return;
                }

                const state = await this.buildViewStateFromUri(viewType, params);
                await this.openLeafFromState(viewType, position, state);
            })();
        });
    }

    /**
     * Build the canonical workspace-state dict for `setViewState` from URI
     * parameters. Merges: schema defaults (via codec REPLACE semantics inside
     * the view's setState) ← template config ← URI query params.
     */
    private async buildViewStateFromUri(
        viewType: string,
        params: Record<string, string>,
    ): Promise<Record<string, unknown>> {
        const codec = codecFor(viewType);
        if (!codec) return {};

        // Step 1: template provides base config dict
        let baseConfig: Record<string, unknown> = {};
        let baseName: string | undefined;
        if (params.template) {
            const loader = new ViewTemplateLoader(this.app);
            const summary = loader.findByBasename(this.settings.viewTemplateFolder, params.template);
            if (summary) {
                const tmpl = await loader.loadFullTemplate(summary.filePath);
                if (tmpl) {
                    baseConfig = tmpl.config ?? {};
                    baseName = tmpl.name;
                }
            } else {
                new Notice(t('notice.templateNotFound', { name: params.template }));
            }
        }

        // Step 2: parse template config + URI overrides through codec.
        // codec.fromUriParams handles both canonical names AND legacyKeys
        // (e.g. `days` → `daysToShow`), so old URIs and new URIs both work.
        const baseParsed = codec.parseConfig(baseConfig);
        const uriParsed = codec.fromUriParams(params);
        const mergedConfig = { ...baseParsed, ...uriParsed };

        // Step 3: name precedence: URI param > template name > current config.
        if (params.name) {
            (mergedConfig as Record<string, unknown>).customName = params.name;
        } else if (baseName && (mergedConfig as Record<string, unknown>).customName === undefined) {
            (mergedConfig as Record<string, unknown>).customName = baseName;
        }

        // Step 4: re-serialize to canonical state dict (this is exactly what
        // each view's setState parses back via the same codec — round-trip
        // identity through the codec is the symmetry guarantee).
        const transientSeed = codec.parseTransient(params);
        return {
            ...codec.serializeConfig(mergedConfig),
            ...codec.serializeTransient(transientSeed),
        };
    }

    /**
     * Legacy short-name compat for old URIs/code that referenced views by
     * the obsidian view-type suffix-style. Returns undefined if unknown.
     */
    private resolveLegacyViewShortName(shortName: string): string | undefined {
        // Timer never had a schema; it stays in this lookup since
        // resolveViewTypeFromShortName only knows registered schemas.
        if (shortName === 'timer') return VIEW_TYPE_TIMER;
        return undefined;
    }

    private parseUriPosition(raw: string | undefined): DefaultLeafPosition | 'tab' | 'window' | 'override' | undefined {
        const valid = new Set(['left', 'right', 'tab', 'window', 'override']);
        if (raw && valid.has(raw)) return raw as DefaultLeafPosition | 'tab' | 'window' | 'override';
        return undefined;
    }

    private async openTimerFromUri(
        params: Record<string, string>,
        position: DefaultLeafPosition | 'tab' | 'window' | 'override' | undefined,
    ): Promise<void> {
        const state: Record<string, unknown> = {};
        if (params.mode) state.timerViewMode = params.mode;
        if (params.intervalTemplate) state.intervalTemplate = params.intervalTemplate;
        if (params.name) state.customName = params.name;
        await this.openLeafFromState(VIEW_TYPE_TIMER, position, state);
    }

    async loadSettings() {
        const raw = await this.loadData();
        const rawObject = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};

        // Legacy setting key migration (v0.33 → v0.34): values written under the
        // old Frontmatter* names are transcribed to the new Tv* names. Next
        // saveSettings persists only the new keys so legacy ones disappear.
        const migrate = (oldKey: string, newKey: string) => {
            if (rawObject[oldKey] !== undefined && rawObject[newKey] === undefined) {
                rawObject[newKey] = rawObject[oldKey];
            }
            delete rawObject[oldKey];
        };
        migrate('frontmatterTaskKeys', 'tvFileKeys');
        migrate('frontmatterTaskHeader', 'tvFileChildHeader');
        migrate('frontmatterTaskHeaderLevel', 'tvFileChildHeaderLevel');
        migrate('fileMenuForFrontmatterTasks', 'fileMenuForTvFile');
        migrate('calendarWeekStartDay', 'weekStartDay');

        // Astronomy migration (v0.39 → v0.40): flat showSunTimes / showMoonPhase
        // / homeLatitude / homeLongitude → nested astronomy.{display,location}.
        migrateAstronomySettings(rawObject);

        // doubleTapAction migration (v0.44 → v0.45): 'properties' はタスクハブ
        // モーダル統合で 'detail'（= ハブ）に吸収された。
        if (rawObject['doubleTapAction'] === 'properties') {
            rawObject['doubleTapAction'] = 'detail';
        }

        const merged = Object.assign({}, DEFAULT_SETTINGS, rawObject) as TaskViewerSettings;
        const normalizedKeys = normalizeTvFileKeys(merged.tvFileKeys);
        const keysValidationError = validateTvFileKeys(normalizedKeys);

        this.settings = {
            ...merged,
            tvFileKeys: keysValidationError
                ? { ...DEFAULT_TV_FILE_KEYS }
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
        this.readService.updateStartHour(this.settings.startHour);
        this.updateViewHeaderStyles();

        this.refreshAllViews();
    }

    updateGlobalStyles() {
        if (this.settings.applyGlobalStyles) {
            document.body.classList.add('task-viewer-global-styles');
        } else {
            document.body.classList.remove('task-viewer-global-styles');
        }
    }

    updateViewHeaderStyles() {
        if (this.settings.hideViewHeader) {
            document.body.classList.add('task-viewer-hide-view-header');
        } else {
            document.body.classList.remove('task-viewer-hide-view-header');
        }
        if (this.settings.fixMobileGradientWidth) {
            document.body.classList.add('task-viewer-fix-mobile-gradient');
        } else {
            document.body.classList.remove('task-viewer-fix-mobile-gradient');
        }
        document.documentElement.style.setProperty(
            '--tv-mobile-top-offset', `${this.settings.mobileTopOffset}px`
        );
    }

    notifyEditorMenuSettingsChanged() {
        this.taskMenuNotifySettingsChanged?.();
    }

    /**
     * ビュー外コンテキスト（editor ··· menu / file-menu）からタスクハブ
     * モーダルを開く。ビュー内はビュー自身の openTaskHub（自前の
     * TaskCardRenderer / MenuHandler を使用）を通る。
     */
    openTaskHub(taskId: string, options?: TaskHubPanelOptions): void {
        const task = this.readService.getTask(taskId);
        if (!task) return;

        if (!this.hubTaskRenderer) {
            this.hubTaskRenderer = new TaskCardRenderer(
                this.app, this.readService, this.writeService, this.menuPresenter,
                {
                    hoverSource: TASK_VIEWER_HOVER_SOURCE_ID,
                    getHoverParent: () => this.hubHoverParent,
                },
                () => this.settings,
                () => false,
            );
            this.addChild(this.hubTaskRenderer);
        }
        if (!this.hubMenuHandler) {
            this.hubMenuHandler = new MenuHandler(this.app, this.readService, this.writeService, this);
            this.hubMenuHandler.setTaskHubOpener((id, opts) => this.openTaskHub(id, opts));
        }

        new TaskHubPanel(this.app, task, {
            taskRenderer: this.hubTaskRenderer,
            menuHandler: this.hubMenuHandler,
            readService: this.readService,
            writeService: this.writeService,
            plugin: this,
        }, options).open();
    }

    // Public accessors for services
    getTaskIndex(): TaskIndex {
        return this.taskIndex;
    }

    getTaskReadService(): TaskReadService {
        return this.readService;
    }

    getTaskWriteService(): TaskWriteService {
        return this.writeService;
    }

    getTaskRepository() {
        return this.taskIndex.getRepository();
    }

    getTimerWidget(): TimerWidget {
        return this.timerWidget;
    }

    /**
     * Start checking for day boundary changes every 5 minutes
     */
    private startDateBoundaryCheck(): void {
        // Record current visual date
        this.lastVisualDate = DateUtils.getVisualDateOfNow(this.settings.startHour);

        // Check every 5 minutes
        this.dateCheckInterval = setInterval(() => {
            const currentVisualDate = DateUtils.getVisualDateOfNow(this.settings.startHour);
            if (currentVisualDate !== this.lastVisualDate) {
                this.lastVisualDate = currentVisualDate;
                this.refreshAllViews();
            }
        }, 5 * 60 * 1000); // 5 minutes
    }

    /**
     * Refresh all task viewer views
     */
    public refreshAllViews(): void {
        [VIEW_TYPE_TIMELINE, VIEW_TYPE_SCHEDULE, VIEW_TYPE_CALENDAR, VIEW_TYPE_MINI_CALENDAR, VIEW_TYPE_KANBAN].forEach(viewType => {
            this.app.workspace.getLeavesOfType(viewType).forEach(leaf => {
                // @ts-ignore — refresh() is a custom method on plugin views, not in Obsidian typings
                (leaf.view as any).refresh?.();
            });
        });
    }

    /** Open a view via ribbon / command. No state seeding — view uses its own defaults. */
    async activateView(viewType: string): Promise<void> {
        await this.openLeafFromState(viewType, undefined, {});
    }

    /**
     * Resolve a leaf for `viewType` at `position`, then `setViewState` with
     * the supplied state dict. Single entry point used by both the no-params
     * ribbon/command path and the URI-handler-build state path.
     */
    async openLeafFromState(
        viewType: string,
        position: DefaultLeafPosition | 'tab' | 'window' | 'override' | undefined,
        state: Record<string, unknown>,
    ): Promise<void> {
        const { workspace } = this.app;

        let leaf: WorkspaceLeaf | null = null;

        if (position === 'override') {
            const leaves = workspace.getLeavesOfType(viewType);
            leaf = leaves.length > 0
                ? leaves[0]
                : this.getLeafForPosition(workspace, this.getDefaultPosition(viewType));
        } else if (position) {
            switch (position) {
                case 'left':   leaf = workspace.getLeftLeaf(false); break;
                case 'right':  leaf = workspace.getRightLeaf(false); break;
                case 'tab':    leaf = workspace.getLeaf('tab'); break;
                case 'window': leaf = workspace.getLeaf('window'); break;
            }
        } else {
            const leaves = workspace.getLeavesOfType(viewType);
            leaf = leaves.length === 0
                ? this.getLeafForPosition(workspace, this.getDefaultPosition(viewType))
                : workspace.getLeaf(true);
        }

        if (leaf) {
            await leaf.setViewState({ type: viewType, active: true, state });
            workspace.revealLeaf(leaf);
        }
    }

    private getDefaultPosition(viewType: string): DefaultLeafPosition {
        const positions = this.settings.defaultViewPositions;
        const map: Record<string, DefaultLeafPosition | undefined> = {
            [VIEW_TYPE_TIMELINE]: positions.timeline,
            [VIEW_TYPE_SCHEDULE]: positions.schedule,
            [VIEW_TYPE_CALENDAR]: positions.calendar,
            [VIEW_TYPE_MINI_CALENDAR]: positions.miniCalendar,
            [VIEW_TYPE_TIMER]: positions.timer,
            [VIEW_TYPE_KANBAN]: positions.kanban,
        };
        return map[viewType] ?? 'right';
    }

    private getLeafForPosition(workspace: Workspace, position: DefaultLeafPosition): WorkspaceLeaf | null {
        switch (position) {
            case 'left':   return workspace.getLeftLeaf(false);
            case 'right':  return workspace.getRightLeaf(false);
            case 'tab':    return workspace.getLeaf('tab');
            case 'window': return workspace.getLeaf('window');
        }
    }

    onunload() {
        this.logManager?.stop();
        this.logStorage?.close();
        this.taskMenuCleanup?.();
        untrackAllKeyboards();
        this.taskIndex?.dispose();
        AudioUtils.dispose();
        document.body.classList.remove('task-viewer-global-styles');
        this.timerWidget?.destroy();

        // Clear day boundary check interval
        if (this.dateCheckInterval) {
            clearInterval(this.dateCheckInterval);
            this.dateCheckInterval = null;
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
                const dm = (navigator as any).deviceMemory;
                if (typeof dm === 'number') d.deviceMemoryGb = dm;
            }
        } catch { /* best effort */ }
        try {
            const pm = typeof performance !== 'undefined' ? (performance as any).memory : undefined;
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
            const req = typeof window !== 'undefined' ? (window as any).require : undefined;
            if (typeof req === 'function') {
                const os = req('os');
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
        const viewTypes = [
            VIEW_TYPE_TIMELINE, VIEW_TYPE_SCHEDULE, VIEW_TYPE_CALENDAR,
            VIEW_TYPE_MINI_CALENDAR, VIEW_TYPE_KANBAN, VIEW_TYPE_TIMER,
        ];
        let count = 0;
        for (const vt of viewTypes) {
            count += this.app.workspace.getLeavesOfType(vt).length;
        }
        return count;
    }

    private getEnabledParsers(): string[] {
        const parsers = ['tv-inline', 'tv-file'];
        if (this.settings.enableTasksPlugin) parsers.push('tasks-plugin');
        if (this.settings.enableDayPlanner) parsers.push('day-planner');
        return parsers;
    }

}
