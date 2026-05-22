import { setIcon, type App, type WorkspaceLeaf } from 'obsidian';
import { t } from '../../i18n';
import type TaskViewerPlugin from '../../main';
import type { TaskReadService } from '../../services/data/TaskReadService';
import { VIEW_META_KANBAN } from '../../constants/viewRegistry';
import { ViewSettingsMenu, MaskToggleButton, ViewToolbarBase } from '../sharedUI/ViewToolbar';
import { FilterMenuComponent } from '../customMenus/FilterMenuComponent';
import { codecFor, type ViewConfigCodec } from '../../services/viewConfig';
import { KanbanSchema, type KanbanConfig, type KanbanTransient } from './KanbanSchema';

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

    /** Snapshot the view's full persistable config for template-save / URI build. */
    getCurrentConfig: () => Partial<KanbanConfig>;
    /** Apply a parsed config (from template load / URI / reset). */
    applyConfig: (cfg: Partial<KanbanConfig>) => void;
    /** Trigger render + saveLayout side effects after applyConfig. */
    onConfigApplied: () => void;

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

    private get codec(): ViewConfigCodec<KanbanConfig, KanbanTransient> {
        return codecFor(KanbanSchema.viewType) as ViewConfigCodec<KanbanConfig, KanbanTransient>;
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
                grid: deps.getCurrentConfig().grid,
                filterState: deps.filterMenu.getFilterState(),
            }),
            viewType: VIEW_META_KANBAN.type,
            getViewTemplateFolder: () => deps.plugin.settings.viewTemplateFolder,
            getViewTemplate: () => ({
                filePath: '',
                name: deps.getCustomName() || VIEW_META_KANBAN.displayText,
                viewType: KanbanSchema.shortName,
                config: this.codec.serializeConfig(deps.getCurrentConfig()),
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
                const cfg = this.codec.parseConfig(template.config ?? null);
                deps.applyConfig(cfg);
                if (template.name) deps.onRename(template.name);
                deps.onConfigApplied();
            },
            onReset: () => {
                deps.applyConfig({});
                deps.onRename(undefined);
                deps.onConfigApplied();
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
