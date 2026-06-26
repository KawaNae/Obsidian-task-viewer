import { setIcon, type App, type Menu, type WorkspaceLeaf } from 'obsidian';
import { t } from '../../i18n';
import type TaskViewerPlugin from '../../main';
import type { TaskReadService } from '../../services/data/TaskReadService';
import type { AstronomyDisplay } from '../../types';
import { ViewToolbarBase, ViewSettingsMenu, type ViewSettingsOptions } from '../sharedUI/ViewToolbar';
import { DateLabel } from '../sharedUI/DateLabel';
import { DateNavigator } from '../sharedUI/ViewToolbar';
import { appendAstronomyMenuSection } from '../sharedUI/AstronomyMenuSection';
import { FilterMenuComponent } from '../customMenus/FilterMenuComponent';
import type { TaskLinkInteractionManager } from '../taskcard/TaskLinkInteractionManager';
import type { TaskViewHoverParent } from '../taskcard/TaskViewHoverParent';
import { codecFor, type ViewConfigCodec } from '../../services/viewConfig';
import { VIEW_META_MINI_CALENDAR } from '../../constants/viewRegistry';
import { MiniCalendarSchema, type MiniCalendarConfig, type MiniCalendarTransient } from './MiniCalendarSchema';

export interface MiniCalendarToolbarDeps {
    app: App;
    leaf: WorkspaceLeaf;
    plugin: TaskViewerPlugin;
    readService: TaskReadService;
    filterMenu: FilterMenuComponent;
    linkInteractionManager: TaskLinkInteractionManager;
    hoverParent: TaskViewHoverParent;

    getReferenceMonth: () => { year: number; month: number };
    onNavigateWeek: (direction: number) => void;
    onJumpToCurrentMonth: () => void;
    onFilterChange: () => void;

    getCustomName: () => string | undefined;
    onRename: (newName: string | undefined) => void;
    getCurrentConfig: () => Partial<MiniCalendarConfig>;
    applyConfig: (cfg: Partial<MiniCalendarConfig>) => void;
    onConfigApplied: () => void;

    getAstronomyDisplay: () => Partial<AstronomyDisplay> | undefined;
    setAstronomyDisplay: (next: Partial<AstronomyDisplay> | undefined) => void;
}

export class MiniCalendarToolbar extends ViewToolbarBase {
    private dateLabelHandle: { update: (year: number, month: number) => void } | null = null;
    private moreBtn: HTMLElement | null = null;

    constructor(private deps: MiniCalendarToolbarDeps) {
        super();
    }

    private get codec(): ViewConfigCodec<MiniCalendarConfig, MiniCalendarTransient> {
        return codecFor(VIEW_META_MINI_CALENDAR.type) as ViewConfigCodec<MiniCalendarConfig, MiniCalendarTransient>;
    }

    protected override buildDom(toolbar: HTMLElement): void {
        const { deps } = this;

        const dateLabelDeps = {
            app: deps.app,
            getSettings: () => deps.plugin.settings,
            linkInteractionManager: deps.linkInteractionManager,
            hoverParent: deps.hoverParent,
        };
        this.dateLabelHandle = DateLabel.render(toolbar, dateLabelDeps);
        const ref = deps.getReferenceMonth();
        this.dateLabelHandle.update(ref.year, ref.month);
        DateLabel.bindHoverPreview(toolbar, dateLabelDeps);

        toolbar.createDiv('view-toolbar__spacer');

        DateNavigator.render(
            toolbar,
            (days) => deps.onNavigateWeek(days),
            () => deps.onJumpToCurrentMonth(),
            { vertical: true }
        );

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

    override update(): void {
        const ref = this.deps.getReferenceMonth();
        this.dateLabelHandle?.update(ref.year, ref.month);
        if (this.moreBtn) {
            this.moreBtn.classList.toggle('is-filtered', this.deps.filterMenu.hasActiveFilters());
        }
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
    }

    private getSettingsOptions(): ViewSettingsOptions {
        const { deps } = this;
        return {
            app: deps.app,
            leaf: deps.leaf,
            getCustomName: () => deps.getCustomName(),
            getDefaultName: () => VIEW_META_MINI_CALENDAR.displayText,
            onRename: (newName) => deps.onRename(newName),
            buildUri: () => ({
                configParams: this.codec.toUriParams(deps.getCurrentConfig()),
            }),
            viewType: VIEW_META_MINI_CALENDAR.type,
            getViewTemplateFolder: () => deps.plugin.settings.viewTemplateFolder,
            getViewTemplate: () => ({
                filePath: '',
                name: deps.getCustomName() || VIEW_META_MINI_CALENDAR.displayText,
                viewType: 'calendar',
                config: this.codec.serializeConfig(deps.getCurrentConfig()),
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
                    overlays: ['moonPhase'],
                    settings: deps.plugin.settings.astronomy,
                    instance: deps.getAstronomyDisplay(),
                    onChange: (next) => deps.setAstronomyDisplay(next),
                });
            },
        };
    }
}
