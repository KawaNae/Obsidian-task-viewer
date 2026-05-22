import { setIcon, type App, type WorkspaceLeaf } from 'obsidian';
import { t } from '../../i18n';
import type TaskViewerPlugin from '../../main';
import type { TaskReadService } from '../../services/data/TaskReadService';
import { VIEW_META_SCHEDULE } from '../../constants/viewRegistry';
import { DateNavigator, ViewSettingsMenu, MaskToggleButton, ViewToolbarBase } from '../sharedUI/ViewToolbar';
import { appendAstronomyMenuSection } from '../sharedUI/AstronomyMenuSection';
import { FilterMenuComponent } from '../customMenus/FilterMenuComponent';
import type { AstronomyDisplay } from '../../types';
import { codecFor, type ViewConfigCodec } from '../../services/viewConfig';
import { ScheduleSchema, type ScheduleConfig, type ScheduleTransient } from './ScheduleSchema';

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

    /** Snapshot the view's full persistable config for template-save / URI build. */
    getCurrentConfig: () => Partial<ScheduleConfig>;
    /** Apply a parsed config (from template load / URI / reset). */
    applyConfig: (cfg: Partial<ScheduleConfig>) => void;
    /** Trigger render + saveLayout side effects after applyConfig. */
    onConfigApplied: () => void;

    getMaskMode: () => boolean;
    setMaskMode: (next: boolean) => void;

    getAstronomyDisplay: () => Partial<AstronomyDisplay> | undefined;
    setAstronomyDisplay: (next: Partial<AstronomyDisplay> | undefined) => void;
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

    private get codec(): ViewConfigCodec<ScheduleConfig, ScheduleTransient> {
        return codecFor(ScheduleSchema.viewType) as ViewConfigCodec<ScheduleConfig, ScheduleTransient>;
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
                viewType: ScheduleSchema.shortName,
                config: this.codec.serializeConfig(deps.getCurrentConfig()),
            }),
            getExportContainer: () => deps.container,
            getExportSpec: () => ({
                scrollAreas: ['.schedule-view__body-scroll'],
                overflowParents: '.schedule-view, .schedule-view__body-scroll',
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
            appendCustomItems: (menu) => {
                appendAstronomyMenuSection(menu, {
                    // Schedule has a time axis just like Timeline, so it shows
                    // both sun + moon toggles (corrects an earlier omission).
                    overlays: ['sunTimes', 'moonPhase'],
                    settings: deps.plugin.settings.astronomy,
                    instance: deps.getAstronomyDisplay(),
                    onChange: (next) => deps.setAstronomyDisplay(next),
                });
            },
        });
    }

    override update(): void {
        if (this.filterBtn) {
            this.filterBtn.classList.toggle('is-filtered', this.deps.filterMenu.hasActiveFilters());
        }
        this.maskHandle?.update();
    }
}
