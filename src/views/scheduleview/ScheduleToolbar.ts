import { setIcon, type App, type WorkspaceLeaf } from 'obsidian';
import { t } from '../../i18n';
import type TaskViewerPlugin from '../../main';
import type { TaskReadService } from '../../services/data/TaskReadService';
import { createEmptyFilterState } from '../../services/filter/FilterTypes';
import { VIEW_META_SCHEDULE } from '../../constants/viewRegistry';
import { DateNavigator, ViewSettingsMenu, MaskToggleButton, ViewToolbarBase } from '../sharedUI/ViewToolbar';
import { FilterMenuComponent } from '../customMenus/FilterMenuComponent';

export interface ScheduleToolbarDeps {
    app: App;
    leaf: WorkspaceLeaf;
    plugin: TaskViewerPlugin;
    readService: TaskReadService;
    filterMenu: FilterMenuComponent;
    container: HTMLElement;

    onNavigate: (days: number) => void;
    onToday: () => void;
    onFilterChange: () => void;

    getCustomName: () => string | undefined;
    onRename: (newName: string | undefined) => void;
    onApplyFilterTemplate: (filterState: ReturnType<FilterMenuComponent['getFilterState']>) => void;
    onReset: () => void;

    getMaskMode: () => boolean;
    setMaskMode: (next: boolean) => void;
}

/**
 * Persistent toolbar for ScheduleView. Re-attached on each render via mount/detach
 * so the filter button (and any open popover) survive container.empty().
 */
export class ScheduleToolbar extends ViewToolbarBase {
    private filterBtn: HTMLButtonElement | null = null;
    private maskHandle: { update: () => void } | null = null;

    constructor(private deps: ScheduleToolbarDeps) {
        super();
    }

    protected override buildDom(toolbar: HTMLElement): void {
        const { deps } = this;

        DateNavigator.render(
            toolbar,
            (days) => deps.onNavigate(days),
            () => deps.onToday(),
            { label: t('toolbar.now') }
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
            getDefaultName: () => VIEW_META_SCHEDULE.displayText,
            onRename: (newName) => deps.onRename(newName),
            buildUri: () => ({
                filterState: deps.filterMenu.getFilterState(),
            }),
            viewType: VIEW_META_SCHEDULE.type,
            getViewTemplateFolder: () => deps.plugin.settings.viewTemplateFolder,
            getViewTemplate: () => ({
                filePath: '',
                name: deps.getCustomName() || VIEW_META_SCHEDULE.displayText,
                viewType: 'schedule',
                filterState: deps.filterMenu.getFilterState(),
                maskMode: deps.getMaskMode(),
            }),
            getExportContainer: () => deps.container,
            getExportSpec: () => ({
                scrollAreas: ['.schedule-view__body-scroll'],
                overflowParents: '.schedule-view, .schedule-view__body-scroll',
            }),
            onApplyTemplate: (template) => {
                if (template.filterState) {
                    deps.filterMenu.setFilterState(template.filterState);
                    deps.onApplyFilterTemplate(template.filterState);
                }
                if (template.maskMode != null) {
                    deps.setMaskMode(template.maskMode);
                }
                if (template.name) {
                    deps.onRename(template.name);
                }
            },
            onReset: () => {
                deps.filterMenu.setFilterState(createEmptyFilterState());
                deps.onRename(undefined);
                deps.onReset();
            },
            menuPresenter: deps.plugin.menuPresenter,
        });
    }

    override update(): void {
        if (this.filterBtn) {
            this.filterBtn.classList.toggle('is-filtered', this.deps.filterMenu.hasActiveFilters());
        }
        this.maskHandle?.update();
    }
}
