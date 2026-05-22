import { setIcon, type App, type WorkspaceLeaf } from 'obsidian';
import { t } from '../../i18n';
import type TaskViewerPlugin from '../../main';
import type { TaskReadService } from '../../services/data/TaskReadService';
import type { PinnedListDefinition, AstronomyDisplay } from '../../types';
import { VIEW_META_CALENDAR } from '../../constants/viewRegistry';
import { DateNavigator, ViewSettingsMenu, MaskToggleButton, ViewToolbarBase } from '../sharedUI/ViewToolbar';
import { appendAstronomyMenuSection } from '../sharedUI/AstronomyMenuSection';
import { FilterMenuComponent } from '../customMenus/FilterMenuComponent';
import { updateSidebarToggleButton } from '../sidebar/SidebarToggleButton';
import { codecFor, type ViewConfigCodec } from '../../services/viewConfig';
import { CalendarSchema, type CalendarConfig, type CalendarTransient } from './CalendarSchema';

export interface CalendarToolbarDeps {
    app: App;
    leaf: WorkspaceLeaf;
    plugin: TaskViewerPlugin;
    readService: TaskReadService;
    filterMenu: FilterMenuComponent;
    container: HTMLElement;

    onNavigateWeek: (days: number) => void;
    onNavigateMonth: (direction: number) => void;
    onJumpToCurrentMonth: () => void;
    onFilterChange: () => void;

    getCustomName: () => string | undefined;
    onRename: (newName: string | undefined) => void;
    getPinnedLists: () => PinnedListDefinition[];
    setPinnedLists: (lists: PinnedListDefinition[]) => void;
    getShowSidebar: () => boolean;
    setShowSidebar: (open: boolean, opts: { animate: boolean; persist: boolean }) => void;

    /** Snapshot the view's full persistable config for template-save / URI build. */
    getCurrentConfig: () => Partial<CalendarConfig>;
    /** Apply a parsed config (from template load / URI / reset). */
    applyConfig: (cfg: Partial<CalendarConfig>, opts?: { explicit?: boolean }) => void;
    /** Trigger render + saveLayout side effects after applyConfig. */
    onConfigApplied: () => void;

    getMaskMode: () => boolean;
    setMaskMode: (next: boolean) => void;

    getAstronomyDisplay: () => Partial<AstronomyDisplay> | undefined;
    setAstronomyDisplay: (next: Partial<AstronomyDisplay> | undefined) => void;
}

/**
 * Persistent toolbar for CalendarView.
 */
export class CalendarToolbar extends ViewToolbarBase {
    private filterBtn: HTMLButtonElement | null = null;
    private sidebarToggleBtn: HTMLButtonElement | null = null;
    private maskHandle: { update: () => void } | null = null;

    constructor(private deps: CalendarToolbarDeps) {
        super();
    }

    private get codec(): ViewConfigCodec<CalendarConfig, CalendarTransient> {
        return codecFor(CalendarSchema.viewType) as ViewConfigCodec<CalendarConfig, CalendarTransient>;
    }

    syncSidebarToggleState(): void {
        if (this.sidebarToggleBtn) {
            updateSidebarToggleButton(this.sidebarToggleBtn, this.deps.getShowSidebar());
        }
    }

    protected override buildDom(toolbar: HTMLElement): void {
        const { deps } = this;

        DateNavigator.render(
            toolbar,
            (days) => deps.onNavigateWeek(days),
            () => deps.onJumpToCurrentMonth(),
            {
                vertical: true,
                onNavigateFast: (direction) => deps.onNavigateMonth(direction),
            }
        );

        toolbar.createDiv('view-toolbar__spacer');

        const filterBtn = toolbar.createEl('button', { cls: 'view-toolbar__btn--icon' });
        setIcon(filterBtn, 'filter');
        filterBtn.setAttribute('aria-label', t('toolbar.filter'));
        filterBtn.addEventListener('click', (event: MouseEvent) => {
            deps.filterMenu.showMenu(event, {
                onFilterChange: () => {
                    deps.onFilterChange();
                    this.update();
                },
                getTasks: () => deps.readService.getTasks(),
                getStartHour: () => deps.plugin.settings.startHour,
            });
        });
        this.filterBtn = filterBtn;

        this.maskHandle = MaskToggleButton.render(toolbar, {
            getMaskMode: () => deps.getMaskMode(),
            setMaskMode: (next) => deps.setMaskMode(next),
        });

        ViewSettingsMenu.renderButton(toolbar, {
            app: deps.app,
            leaf: deps.leaf,
            getCustomName: () => deps.getCustomName(),
            getDefaultName: () => VIEW_META_CALENDAR.displayText,
            onRename: (newName) => deps.onRename(newName),
            buildUri: () => ({
                filterState: deps.filterMenu.getFilterState(),
                pinnedLists: deps.getPinnedLists(),
                showSidebar: deps.getShowSidebar(),
            }),
            viewType: VIEW_META_CALENDAR.type,
            getViewTemplateFolder: () => deps.plugin.settings.viewTemplateFolder,
            getViewTemplate: () => ({
                filePath: '',
                name: deps.getCustomName() || VIEW_META_CALENDAR.displayText,
                viewType: CalendarSchema.shortName,
                config: this.codec.serializeConfig(deps.getCurrentConfig()),
            }),
            getExportContainer: () => deps.container.querySelector<HTMLElement>('.cal-grid'),
            getExportSpec: () => ({
                scrollAreas: ['.cal-grid__body'],
                overflowParents: '.calendar-view, .cal-grid',
            }),
            onApplyTemplate: (template) => {
                const cfg = this.codec.parseConfig(template.config ?? null);
                deps.applyConfig(cfg, { explicit: true });
                if (template.name) deps.onRename(template.name);
                deps.onConfigApplied();
            },
            onReset: () => {
                deps.applyConfig({}, { explicit: true });
                deps.onRename(undefined);
                deps.onConfigApplied();
            },
            menuPresenter: deps.plugin.menuPresenter,
            appendCustomItems: (menu) => {
                appendAstronomyMenuSection(menu, {
                    overlays: ['moonPhase'],
                    settings: deps.plugin.settings.astronomy,
                    instance: deps.getAstronomyDisplay(),
                    onChange: (next) => deps.setAstronomyDisplay(next),
                });
            },
        });

        const toggleBtn = toolbar.createEl('button', {
            cls: 'view-toolbar__btn--icon sidebar-toggle-button-icon',
        });
        updateSidebarToggleButton(toggleBtn, deps.getShowSidebar());
        toggleBtn.onclick = () => {
            const nextOpen = !deps.getShowSidebar();
            deps.setShowSidebar(nextOpen, { animate: true, persist: true });
        };
        this.sidebarToggleBtn = toggleBtn;
    }

    override update(): void {
        if (this.filterBtn) {
            this.filterBtn.classList.toggle('is-filtered', this.deps.filterMenu.hasActiveFilters());
        }
        this.maskHandle?.update();
        this.syncSidebarToggleState();
    }
}
