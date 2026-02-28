import { Notice, Plugin, Workspace, WorkspaceLeaf, TFile, Menu, Editor, MarkdownView } from 'obsidian';
import { TaskIndex } from './services/core/TaskIndex';
import { TimelineView, VIEW_TYPE_TIMELINE } from './views/timelineview';
import { ScheduleView, VIEW_TYPE_SCHEDULE } from './views/scheduleview';
import { CalendarView, VIEW_TYPE_CALENDAR, MiniCalendarView, VIEW_TYPE_MINI_CALENDAR } from './views/calendar';
import { TimerView, VIEW_TYPE_TIMER } from './views/TimerView';
import { TimerWidget } from './timer/TimerWidget';
import {
    TaskViewerSettings,
    DEFAULT_SETTINGS,
    DEFAULT_FRONTMATTER_TASK_KEYS,
    normalizeFrontmatterTaskKeys,
    validateFrontmatterTaskKeys,
} from './types';
import type { DefaultLeafPosition, PinnedListDefinition } from './types';
import { normalizeAiIndexSettings } from './services/aiindex/AiIndexSettings';
import { TaskViewerSettingTab } from './settings';
import { ColorSuggest } from './suggest/color/ColorSuggest';
import { LineStyleSuggest } from './suggest/line/LineStyleSuggest';
import { PropertySuggestObserver } from './suggest/PropertySuggestObserver';
import { DateUtils } from './utils/DateUtils';
import { AudioUtils } from './utils/AudioUtils';
import { TASK_VIEWER_HOVER_SOURCE_DISPLAY, TASK_VIEWER_HOVER_SOURCE_ID } from './constants/hover';
import { getViewMeta } from './constants/viewRegistry';
import type { FilterState } from './services/filter/FilterTypes';
import { hasConditions } from './services/filter/FilterTypes';
import { FilterSerializer } from './services/filter/FilterSerializer';
import { unicodeAtob } from './utils/base64';
import { ViewTemplateLoader } from './services/template/ViewTemplateLoader';
import { PropertiesMenuBuilder } from './interaction/menu/builders/PropertiesMenuBuilder';
import { PropertyCalculator } from './interaction/menu/PropertyCalculator';
import { PropertyFormatter } from './interaction/menu/PropertyFormatter';
import { TimerMenuBuilder } from './interaction/menu/builders/TimerMenuBuilder';
import { TaskActionsMenuBuilder } from './interaction/menu/builders/TaskActionsMenuBuilder';
import { EditorCheckboxMenuBuilder } from './interaction/menu/builders/EditorCheckboxMenuBuilder';

export default class TaskViewerPlugin extends Plugin {
    private taskIndex: TaskIndex;
    private timerWidget: TimerWidget;
    public settings: TaskViewerSettings;

    // Day boundary check
    private lastVisualDate: string = '';
    private dateCheckInterval: ReturnType<typeof setInterval> | null = null;

    // Properties View color/linestyle suggest observer
    private propertySuggestObserver: PropertySuggestObserver | null = null;

    async onload() {
        console.log('Loading Task Viewer Plugin (Rewrite)');

        // Load Settings
        await this.loadSettings();

        // Initialize Services
        this.taskIndex = new TaskIndex(this.app, this.settings, this.manifest.version);
        await this.taskIndex.initialize();

        // Initialize Timer Widget
        this.timerWidget = new TimerWidget(this.app, this);

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
            (leaf) => new TimelineView(leaf, this.taskIndex, this)
        );

        this.registerView(
            VIEW_TYPE_SCHEDULE,
            (leaf) => new ScheduleView(leaf, this.taskIndex, this)
        );

        this.registerView(
            VIEW_TYPE_TIMER,
            (leaf) => new TimerView(leaf, this)
        );

        this.registerView(
            VIEW_TYPE_CALENDAR,
            (leaf) => new CalendarView(leaf, this.taskIndex, this)
        );

        this.registerView(
            VIEW_TYPE_MINI_CALENDAR,
            (leaf) => new MiniCalendarView(leaf, this.taskIndex, this)
        );

        const timelineViewMeta = getViewMeta(VIEW_TYPE_TIMELINE);
        const scheduleViewMeta = getViewMeta(VIEW_TYPE_SCHEDULE);
        const timerViewMeta = getViewMeta(VIEW_TYPE_TIMER);
        const calendarViewMeta = getViewMeta(VIEW_TYPE_CALENDAR);
        const miniCalendarViewMeta = getViewMeta(VIEW_TYPE_MINI_CALENDAR);

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
            id: 'task-viewer-rebuild-ai-index',
            name: 'Task Viewer: Rebuild AI Index',
            callback: async () => {
                try {
                    await this.taskIndex.rebuildAiIndex();
                    new Notice('Task Viewer: AI index rebuilt.');
                } catch (error) {
                    console.error('[TaskViewer] Failed to rebuild AI index:', error);
                    new Notice('Task Viewer: failed to rebuild AI index.');
                }
            }
        });

        this.addCommand({
            id: 'task-viewer-toggle-ai-index',
            name: 'Task Viewer: Toggle AI Index',
            callback: async () => {
                this.settings.aiIndex.enabled = !this.settings.aiIndex.enabled;
                await this.saveSettings();

                if (this.settings.aiIndex.enabled) {
                    await this.taskIndex.rebuildAiIndex();
                    new Notice('Task Viewer: AI index enabled.');
                } else {
                    new Notice('Task Viewer: AI index disabled.');
                }
            }
        });

        this.addCommand({
            id: 'task-viewer-open-ai-index-file',
            name: 'Task Viewer: Open AI Index File',
            callback: async () => {
                try {
                    await this.taskIndex.openAiIndexFile();
                } catch (error) {
                    console.error('[TaskViewer] Failed to open AI index file:', error);
                    new Notice('Task Viewer: failed to open AI index file.');
                }
            }
        });

        // Register Settings Tab
        this.addSettingTab(new TaskViewerSettingTab(this.app, this));

        // Register Editor Suggest
        this.registerEditorSuggest(new ColorSuggest(this.app, this));
        this.registerEditorSuggest(new LineStyleSuggest(this.app, this));

        // Register editor context menu for @notation tasks
        const editorPropertiesBuilder = new PropertiesMenuBuilder(
            this.app, this.taskIndex, this,
            new PropertyCalculator(), new PropertyFormatter()
        );
        const editorTimerBuilder = new TimerMenuBuilder(this);
        const editorActionsBuilder = new TaskActionsMenuBuilder(this.app, this.taskIndex, this);
        const editorCheckboxBuilder = new EditorCheckboxMenuBuilder();

        this.registerEvent(
            this.app.workspace.on('editor-menu', (menu: Menu, editor: Editor, view: MarkdownView) => {
                const filePath = view.file?.path;
                if (!filePath) return;

                const line = editor.getCursor().line;
                const task = this.taskIndex.getTaskByFileLine(filePath, line);

                if (task) {
                    menu.addSeparator();
                    editorPropertiesBuilder.buildPropertiesSubmenu(menu, task, null);
                    menu.addSeparator();
                    editorTimerBuilder.addTimerSubmenu(menu, task);
                    menu.addSeparator();
                    editorActionsBuilder.addTaskActions(menu, task);
                } else {
                    editorCheckboxBuilder.addStatusMenu(menu, editor, line, this.settings.enableStatusMenu, this.settings.statusMenuChars);
                }
            })
        );

        // Apply global styles if enabled
        this.updateGlobalStyles();

        // Start day boundary check (every 5 minutes)
        this.startDateBoundaryCheck();

        // Start Properties View color suggest observer
        this.propertySuggestObserver = new PropertySuggestObserver(
            this.app,
            () => this.settings,
            this
        );
        this.propertySuggestObserver.start();

        // Register URI handler: obsidian://task-viewer?view=timeline&days=3&filter=<base64>&pinnedLists=<base64>
        this.registerObsidianProtocolHandler('task-viewer', (params) => {
            void (async () => {
            const viewMap: Record<string, string> = {
                timeline: VIEW_TYPE_TIMELINE,
                calendar: VIEW_TYPE_CALENDAR,
                schedule: VIEW_TYPE_SCHEDULE,
                'mini-calendar': VIEW_TYPE_MINI_CALENDAR,
                timer: VIEW_TYPE_TIMER,
            };
            const viewType = viewMap[params.view];
            if (!viewType) return;

            const uriParams: {
                filterState?: FilterState;
                days?: number;
                zoom?: number;
                date?: string;
                pinnedLists?: PinnedListDefinition[];
                showSidebar?: boolean;
                position?: 'left' | 'right' | 'tab' | 'window' | 'override';
                name?: string;
                timerMode?: string;
                intervalTemplate?: string;
            } = {};

            // Timer view: mode and interval template params
            if (viewType === VIEW_TYPE_TIMER) {
                if (params.mode) uriParams.timerMode = params.mode;
                if (params.intervalTemplate) uriParams.intervalTemplate = params.intervalTemplate;
            } else {
                // Template resolution (provides base values; inline params override below)
                if (params.template) {
                    const loader = new ViewTemplateLoader(this.app);
                    const summary = loader.findByBasename(
                        this.settings.viewTemplateFolder,
                        params.template,
                    );
                    if (summary) {
                        const template = await loader.loadFullTemplate(summary.filePath);
                        if (template) {
                            if (template.filterState) uriParams.filterState = template.filterState;
                            if (template.pinnedLists) uriParams.pinnedLists = template.pinnedLists;
                            if (template.days != null) uriParams.days = template.days;
                            if (template.zoom != null) uriParams.zoom = template.zoom;
                            if (template.showSidebar != null) uriParams.showSidebar = template.showSidebar;
                            if (template.name) uriParams.name = template.name;
                        }
                    } else {
                        new Notice(`View template "${params.template}" not found.`);
                    }
                }

                // Filter (base64) — overrides template value
                if (params.filter) {
                    uriParams.filterState = FilterSerializer.fromURIParam(params.filter);
                }

                // PinnedLists (base64) — overrides template value
                if (params.pinnedLists) {
                    try {
                        const parsed = JSON.parse(unicodeAtob(params.pinnedLists));
                        if (Array.isArray(parsed)) uriParams.pinnedLists = parsed;
                    } catch { /* ignore */ }
                }

                // View display params — override template values
                if (params.days) {
                    const days = parseInt(params.days, 10);
                    if ([1, 3, 7].includes(days)) uriParams.days = days;
                }
                if (params.zoom) {
                    const zoom = parseFloat(params.zoom);
                    if (zoom >= 0.25 && zoom <= 10.0) uriParams.zoom = zoom;
                }
                if (params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date)) {
                    uriParams.date = params.date;
                }
                if (params.showSidebar === 'true' || params.showSidebar === 'false') {
                    uriParams.showSidebar = params.showSidebar === 'true';
                }
            }

            const validPositions = new Set(['left', 'right', 'tab', 'window', 'override']);
            if (params.position && validPositions.has(params.position)) {
                uriParams.position = params.position as 'left' | 'right' | 'tab' | 'window' | 'override';
            }
            if (params.name) {
                uriParams.name = params.name;
            }

            this.activateView(viewType, uriParams);
            })();
        });
    }

    async loadSettings() {
        const raw = await this.loadData();
        const rawObject = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
        const merged = Object.assign({}, DEFAULT_SETTINGS, rawObject) as TaskViewerSettings & {
            frontmatterTaskKeys?: unknown;
            aiIndex?: unknown;
        };
        const normalizedFrontmatterKeys = normalizeFrontmatterTaskKeys(merged.frontmatterTaskKeys);
        const keysValidationError = validateFrontmatterTaskKeys(normalizedFrontmatterKeys);
        const normalizedAiIndexSettings = normalizeAiIndexSettings(merged.aiIndex);

        this.settings = {
            ...merged,
            frontmatterTaskKeys: keysValidationError
                ? { ...DEFAULT_FRONTMATTER_TASK_KEYS }
                : normalizedFrontmatterKeys,
            aiIndex: normalizedAiIndexSettings,
        };
    }

    async saveSettings() {
        await this.saveData(this.settings);
        this.taskIndex.updateSettings(this.settings);

        this.refreshAllViews();
    }

    updateGlobalStyles() {
        if (this.settings.applyGlobalStyles) {
            document.body.classList.add('task-viewer-global-styles');
        } else {
            document.body.classList.remove('task-viewer-global-styles');
        }
    }

    // Public accessors for services
    getTaskIndex(): TaskIndex {
        return this.taskIndex;
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
                console.log(`[TaskViewer] Day boundary crossed: ${this.lastVisualDate} -> ${currentVisualDate}`);
                this.lastVisualDate = currentVisualDate;
                this.refreshAllViews();
            }
        }, 5 * 60 * 1000); // 5 minutes
    }

    /**
     * Refresh all task viewer views
     */
    public refreshAllViews(): void {
        [VIEW_TYPE_TIMELINE, VIEW_TYPE_SCHEDULE, VIEW_TYPE_CALENDAR, VIEW_TYPE_MINI_CALENDAR].forEach(viewType => {
            this.app.workspace.getLeavesOfType(viewType).forEach(leaf => {
                (leaf.view as any).refresh?.();
            });
        });
    }

    async activateView(viewType: string, params?: {
        filterState?: FilterState;
        days?: number;
        zoom?: number;
        date?: string;
        pinnedLists?: PinnedListDefinition[];
        showSidebar?: boolean;
        position?: 'left' | 'right' | 'tab' | 'window' | 'override';
        name?: string;
        timerMode?: string;
        intervalTemplate?: string;
    }) {
        const { workspace } = this.app;

        let leaf: WorkspaceLeaf | null = null;

        if (params?.position === 'override') {
            const leaves = workspace.getLeavesOfType(viewType);
            if (leaves.length > 0) {
                leaf = leaves[0];
            } else {
                leaf = this.getLeafForPosition(workspace, this.getDefaultPosition(viewType));
            }
        } else if (params?.position) {
            switch (params.position) {
                case 'left':   leaf = workspace.getLeftLeaf(false); break;
                case 'right':  leaf = workspace.getRightLeaf(false); break;
                case 'tab':    leaf = workspace.getLeaf('tab'); break;
                case 'window': leaf = workspace.getLeaf('window'); break;
            }
        } else {
            const leaves = workspace.getLeavesOfType(viewType);
            if (leaves.length === 0) {
                leaf = this.getLeafForPosition(workspace, this.getDefaultPosition(viewType));
            } else {
                leaf = workspace.getLeaf(true);
            }
        }

        if (leaf) {
            const state: Record<string, unknown> = {
                filterState: params?.filterState && hasConditions(params.filterState)
                    ? FilterSerializer.toJSON(params.filterState)
                    : null,
            };
            if (params?.days != null) state.daysToShow = params.days;
            if (params?.zoom != null) state.zoomLevel = params.zoom;
            if (params?.date != null) state.startDate = params.date;
            if (params?.pinnedLists) state.pinnedLists = params.pinnedLists;
            if (params?.showSidebar != null) state.showSidebar = params.showSidebar;
            if (params?.name) state.customName = params.name;
            if (params?.timerMode) state.timerViewMode = params.timerMode;
            if (params?.intervalTemplate) state.intervalTemplate = params.intervalTemplate;

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
        console.log('Unloading Task Viewer Plugin');
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

}
