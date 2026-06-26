import { setIcon, type App, type Menu, type WorkspaceLeaf } from 'obsidian';
import { t } from '../../i18n';
import type TaskViewerPlugin from '../../main';
import type { TaskReadService } from '../../services/data/TaskReadService';
import { VIEW_META_SCHEDULE } from '../../constants/viewRegistry';
import { DateNavigator, ViewSettingsMenu, MaskToggleButton, ViewToolbarBase, type ViewSettingsOptions } from '../sharedUI/ViewToolbar';
import { DateLabel } from '../sharedUI/DateLabel';
import { appendAstronomyMenuSection } from '../sharedUI/AstronomyMenuSection';
import { FilterMenuComponent } from '../customMenus/FilterMenuComponent';
import type { AstronomyDisplay } from '../../types';
import type { TaskLinkInteractionManager } from '../taskcard/TaskLinkInteractionManager';
import type { TaskViewHoverParent } from '../taskcard/TaskViewHoverParent';
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

    getCurrentDate: () => string;
    linkInteractionManager: TaskLinkInteractionManager;
    hoverParent: TaskViewHoverParent;
}

/**
 * Persistent toolbar for ScheduleView. Re-attached on each render via mount/detach
 * so the filter button (and any open popover) survive container.empty().
 */
export class ScheduleToolbar extends ViewToolbarBase {
    private filterBtn: HTMLButtonElement | null = null;
    private moreBtn: HTMLElement | null = null;
    private dateLabelHandle: { update: (year: number, month: number) => void } | null = null;
    private maskHandle: { update: () => void } | null = null;

    constructor(private deps: ScheduleToolbarDeps) {
        super();
    }

    private get codec(): ViewConfigCodec<ScheduleConfig, ScheduleTransient> {
        return codecFor(ScheduleSchema.viewType) as ViewConfigCodec<ScheduleConfig, ScheduleTransient>;
    }

    private getDateYearMonth(): { year: number; month: number } {
        const d = this.deps.getCurrentDate();
        return { year: parseInt(d.substring(0, 4), 10), month: parseInt(d.substring(5, 7), 10) - 1 };
    }

    protected override buildDom(toolbar: HTMLElement): void {
        const { deps } = this;

        // Date Label (YYYY - MM)
        const dateLabelDeps = {
            app: deps.app,
            getSettings: () => deps.plugin.settings,
            linkInteractionManager: deps.linkInteractionManager,
            hoverParent: deps.hoverParent,
        };
        this.dateLabelHandle = DateLabel.render(toolbar, dateLabelDeps);
        const { year, month } = this.getDateYearMonth();
        this.dateLabelHandle.update(year, month);
        DateLabel.bindHoverPreview(toolbar, dateLabelDeps);

        DateNavigator.render(
            toolbar,
            (days) => deps.onNavigate(days),
            () => deps.onToday(),
            {}
        );

        toolbar.createDiv('view-toolbar__spacer');

        // Action zone (expanded mode)
        const actionZone = toolbar.createDiv('view-toolbar__action-zone');

        const filterBtn = actionZone.createEl('button', { cls: 'view-toolbar__btn--icon' });
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

        this.maskHandle = MaskToggleButton.render(actionZone, {
            getMaskMode: () => deps.getMaskMode(),
            setMaskMode: (next) => deps.setMaskMode(next),
        });

        ViewSettingsMenu.renderButton(actionZone, this.getSettingsOptions());

        // More button (compact mode — ⋮)
        const moreBtn = toolbar.createEl('button', { cls: 'view-toolbar__btn--icon view-toolbar__btn--more' });
        setIcon(moreBtn, 'more-vertical');
        moreBtn.setAttribute('aria-label', t('toolbar.viewSettings'));
        this.moreBtn = moreBtn;

        moreBtn.onclick = (e) => {
            deps.plugin.menuPresenter.present((menu) => {
                this.appendCompactMenuItems(menu, moreBtn);
                menu.addSeparator();
                ViewSettingsMenu.appendItems(menu, this.getSettingsOptions());
            }, { kind: 'mouseEvent', event: e });
        };
    }

    private getSettingsOptions(): ViewSettingsOptions {
        const { deps } = this;
        return {
            app: deps.app,
            leaf: deps.leaf,
            getCustomName: () => deps.getCustomName(),
            getDefaultName: () => VIEW_META_SCHEDULE.displayText,
            onRename: (newName) => deps.onRename(newName),
            buildUri: () => ({
                configParams: this.codec.toUriParams(deps.getCurrentConfig()),
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
                    overlays: ['sunTimes', 'moonPhase'],
                    settings: deps.plugin.settings.astronomy,
                    instance: deps.getAstronomyDisplay(),
                    onChange: (next) => deps.setAstronomyDisplay(next),
                });
            },
        };
    }

    private appendCompactMenuItems(menu: Menu, moreBtn: HTMLElement): void {
        const { deps } = this;
        menu.addItem((item) => {
            item.setTitle(t('toolbar.filter'))
                .setIcon('filter')
                .onClick(() => {
                    deps.filterMenu.showMenuAtElement(moreBtn, {
                        onFilterChange: () => {
                            deps.onFilterChange();
                            this.update();
                        },
                        getTasks: () => deps.readService.getTasks(),
                        getStartHour: () => deps.plugin.settings.startHour,
                    });
                });
        });

        const maskOn = deps.getMaskMode();
        menu.addItem((item) => {
            item.setTitle(t('toolbar.maskMode'))
                .setIcon(maskOn ? 'eye-off' : 'eye')
                .setChecked(maskOn)
                .onClick(() => {
                    deps.setMaskMode(!maskOn);
                    this.update();
                });
        });
    }

    override update(): void {
        const { year, month } = this.getDateYearMonth();
        this.dateLabelHandle?.update(year, month);
        const hasFilters = this.deps.filterMenu.hasActiveFilters();
        if (this.filterBtn) {
            this.filterBtn.classList.toggle('is-filtered', hasFilters);
        }
        if (this.moreBtn) {
            this.moreBtn.classList.toggle('is-filtered', hasFilters);
        }
        this.maskHandle?.update();
    }
}
