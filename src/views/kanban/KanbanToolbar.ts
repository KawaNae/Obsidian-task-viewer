import { setIcon, type App, type WorkspaceLeaf } from 'obsidian';
import { t } from '../../i18n';
import type TaskViewerPlugin from '../../main';
import type { TaskReadService } from '../../services/data/TaskReadService';
import { createEmptyFilterState } from '../../services/filter/FilterTypes';
import type { ViewTemplate } from '../../types';
import { VIEW_META_KANBAN } from '../../constants/viewRegistry';
import { ViewSettingsMenu, MaskToggleButton, ViewToolbarBase } from '../sharedUI/ViewToolbar';
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

    getMaskMode: () => boolean;
    setMaskMode: (next: boolean) => void;
}

/**
 * Persistent toolbar for KanbanView.
 */
export class KanbanToolbar extends ViewToolbarBase {
    private filterBtn: HTMLButtonElement | null = null;
    private maskHandle: { update: () => void } | null = null;

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

        this.maskHandle = MaskToggleButton.render(toolbar, {
            getMaskMode: () => deps.getMaskMode(),
            setMaskMode: (next) => deps.setMaskMode(next),
        });

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
                maskMode: deps.getMaskMode(),
            }),
            getExportContainer: () => deps.container,
            // Kanban needs an extra pass: each cell has its own overflow/minHeight
            // constraint plus a per-column scroll body. expand them all so the
            // full grid is captured.
            getExportSpec: () => ({
                scrollAreas: ['.kanban-view__grid-host', '.kanban-view__cell-body'],
                overflowParents: '.kanban-view, .kanban-view__grid-host',
                extraExpand: (container, restoreFns) => {
                    const cells = Array.from(container.querySelectorAll<HTMLElement>('.kanban-view__cell'));
                    for (const cell of cells) {
                        const origOverflow = cell.style.overflow;
                        const origMinHeight = cell.style.minHeight;
                        cell.style.overflow = 'visible';
                        cell.style.minHeight = 'auto';
                        restoreFns.push(() => {
                            cell.style.overflow = origOverflow;
                            cell.style.minHeight = origMinHeight;
                        });
                    }
                },
            }),
            onApplyTemplate: (template) => {
                if (template.filterState) {
                    deps.filterMenu.setFilterState(template.filterState);
                }
                if (template.maskMode != null) {
                    deps.setMaskMode(template.maskMode);
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
        this.maskHandle?.update();
    }
}
