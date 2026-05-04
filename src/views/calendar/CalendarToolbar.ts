import { setIcon, type App, type WorkspaceLeaf } from 'obsidian';
import { t } from '../../i18n';
import type TaskViewerPlugin from '../../main';
import type { TaskReadService } from '../../services/data/TaskReadService';
import { CalendarExportStrategy } from '../../services/export/CalendarExportStrategy';
import { createEmptyFilterState } from '../../services/filter/FilterTypes';
import type { ViewTemplate, PinnedListDefinition } from '../../types';
import { VIEW_META_CALENDAR } from '../../constants/viewRegistry';
import { DateNavigator, ViewSettingsMenu, ViewToolbarBase } from '../sharedUI/ViewToolbar';
import { FilterMenuComponent } from '../customMenus/FilterMenuComponent';
import { updateSidebarToggleButton } from '../sidebar/SidebarToggleButton';

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
    onApplyTemplate: (template: ViewTemplate) => void;
    onReset: () => void;
}

/**
 * Persistent toolbar for CalendarView.
 */
export class CalendarToolbar extends ViewToolbarBase {
    private filterBtn: HTMLButtonElement | null = null;
    private sidebarToggleBtn: HTMLButtonElement | null = null;

    constructor(private deps: CalendarToolbarDeps) {
        super();
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
                viewType: 'calendar',
                showSidebar: deps.getShowSidebar(),
                filterState: deps.filterMenu.getFilterState(),
                pinnedLists: deps.getPinnedLists(),
            }),
            getExportContainer: () => deps.container.querySelector<HTMLElement>('.cal-grid'),
            getReadService: () => deps.readService,
            getExportStrategy: () => new CalendarExportStrategy(),
            onApplyTemplate: (template) => {
                if (template.filterState) {
                    deps.filterMenu.setFilterState(template.filterState);
                }
                deps.onApplyTemplate(template);
            },
            onReset: () => {
                deps.filterMenu.setFilterState(createEmptyFilterState());
                deps.onReset();
            },
            menuPresenter: deps.plugin.menuPresenter,
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
        this.syncSidebarToggleState();
    }
}
