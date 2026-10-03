import { setIcon, type App, type Menu, type WorkspaceLeaf } from 'obsidian';
import { t } from '../../i18n';
import type { PluginContext } from '../../PluginContext';
import type { TaskReadService } from '../../services/data/TaskReadService';
import type { AstronomyDisplay } from '../../types';
import { ViewToolbarBase, ViewSettingsMenu, type ViewSettingsOptions } from '../sharedUI/ViewToolbar';
import { DateLabel } from '../sharedUI/DateLabel';
import { DateNavigator } from '../sharedUI/ViewToolbar';
import { appendAstronomyMenuSection } from '../sharedUI/AstronomyMenuSection';
import type { FilterMenuComponent } from '../customMenus/FilterMenuComponent';
import type { FilterState } from '../../services/filter/FilterTypes';
import type { TaskLinkInteractionManager } from '../taskcard/TaskLinkInteractionManager';
import type { TaskViewHoverParent } from '../taskcard/TaskViewHoverParent';
import { viewDisplayName } from '../ViewDescriptors';
import { MiniCalendarSchema, MiniCalendarCodec, type MiniCalendarConfig } from './MiniCalendarSchema';
import { readViewConfig } from '../../services/viewConfig/ConfigIssueNotice';

export interface MiniCalendarToolbarDeps {
    app: App;
    leaf: WorkspaceLeaf;
    plugin: PluginContext;
    readService: TaskReadService;
    viewFilterMenu: FilterMenuComponent;
    linkInteractionManager: TaskLinkInteractionManager;
    hoverParent: TaskViewHoverParent;

    getReferenceMonth: () => { year: number; month: number };
    onNavigateWeek: (direction: number) => void;
    onJumpToCurrentMonth: () => void;
    getFilterState: () => FilterState;
    onFilterChange: (next: FilterState) => void;

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

    constructor(private deps: MiniCalendarToolbarDeps) {
        super();
    }

    private readonly codec = MiniCalendarCodec;

    protected override buildDom(toolbar: HTMLElement): void {
        const { deps } = this;

        const dateLabelDeps = {
            app: deps.app,
            getSettings: () => deps.plugin.settings,
            notes: deps.plugin.getOperations(),
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
    }

    private appendCompactMenuItems(menu: Menu, moreBtn: HTMLElement): void {
        const { deps } = this;

        menu.addItem((item) => {
            item.setTitle(t('toolbar.filter'))
                .setIcon('filter')
                .onClick(() => {
                    deps.viewFilterMenu.showMenuAtElement(moreBtn, {
                        value: deps.getFilterState(),
                        onChange: (next) => {
                            deps.onFilterChange(next);
                            this.update();
                        },
                        getTasks: () => deps.plugin.getIndex().getTasks(),
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
            getDefaultName: () => viewDisplayName(MiniCalendarSchema.viewType),
            onRename: (newName) => deps.onRename(newName),
            buildUri: () => ({
                configParams: this.codec.toUriParams(deps.getCurrentConfig()),
            }),
            viewType: MiniCalendarSchema.viewType,
            getViewTemplateFolder: () => deps.plugin.settings.viewTemplateFolder,
            templateNotes: deps.plugin.getOperations(),
            getViewTemplate: () => ({
                filePath: '',
                name: deps.getCustomName() || viewDisplayName(MiniCalendarSchema.viewType),
                viewType: 'calendar',
                config: this.codec.serializeConfig(deps.getCurrentConfig()),
            }),
            onApplyTemplate: (template) => {
                const cfg = readViewConfig(this.codec, template.config ?? null);
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
