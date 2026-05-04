import { setIcon, type App, type WorkspaceLeaf } from 'obsidian';
import { t } from '../../i18n';
import type TaskViewerPlugin from '../../main';
import type { TaskReadService } from '../../services/data/TaskReadService';
import { KanbanExportStrategy } from '../../services/export/KanbanExportStrategy';
import { createEmptyFilterState } from '../../services/filter/FilterTypes';
import type { ViewTemplate } from '../../types';
import { VIEW_META_KANBAN } from '../../constants/viewRegistry';
import { ViewSettingsMenu, ViewToolbarBase } from '../sharedUI/ViewToolbar';
import { FilterMenuComponent } from '../customMenus/FilterMenuComponent';

export interface KanbanToolbarDeps {
    app: App;
    leaf: WorkspaceLeaf;
    plugin: TaskViewerPlugin;
    readService: TaskReadService;
    filterMenu: FilterMenuComponent;
    container: HTMLElement;

    onFilterChange: () => void;

    getCustomName: () => string | undefined;
    onRename: (newName: string | undefined) => void;
    getGrid: () => ViewTemplate['grid'];
    onApplyTemplate: (template: ViewTemplate) => void;
    onReset: () => void;
}

/**
 * Persistent toolbar for KanbanView.
 */
export class KanbanToolbar extends ViewToolbarBase {
    private filterBtn: HTMLButtonElement | null = null;

    constructor(private deps: KanbanToolbarDeps) {
        super();
    }

    protected override buildDom(toolbar: HTMLElement): void {
        const { deps } = this;

        toolbar.createDiv('view-toolbar__spacer');

        const filterBtn = toolbar.createEl('button', { cls: 'view-toolbar__btn--icon' });
        setIcon(filterBtn, 'filter');
        filterBtn.setAttribute('aria-label', t('toolbar.filter'));
        filterBtn.onclick = (event) => {
            deps.filterMenu.showMenu(event as MouseEvent, {
                onFilterChange: () => {
                    deps.onFilterChange();
                    this.update();
                },
                getTasks: () => deps.readService.getTasks(),
                getStartHour: () => deps.plugin.settings.startHour,
            });
        };
        this.filterBtn = filterBtn;

        ViewSettingsMenu.renderButton(toolbar, {
            app: deps.app,
            leaf: deps.leaf,
            getCustomName: () => deps.getCustomName(),
            getDefaultName: () => VIEW_META_KANBAN.displayText,
            onRename: (newName) => deps.onRename(newName),
            buildUri: () => ({
                grid: deps.getGrid(),
                filterState: deps.filterMenu.getFilterState(),
            }),
            viewType: VIEW_META_KANBAN.type,
            getViewTemplateFolder: () => deps.plugin.settings.viewTemplateFolder,
            getViewTemplate: () => ({
                filePath: '',
                name: deps.getCustomName() || VIEW_META_KANBAN.displayText,
                viewType: 'kanban',
                grid: deps.getGrid(),
                filterState: deps.filterMenu.getFilterState(),
            }),
            getExportContainer: () => deps.container,
            getReadService: () => deps.readService,
            getExportStrategy: () => new KanbanExportStrategy(),
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
    }

    override update(): void {
        if (this.filterBtn) {
            this.filterBtn.classList.toggle('is-filtered', this.deps.filterMenu.hasActiveFilters());
        }
    }
}
