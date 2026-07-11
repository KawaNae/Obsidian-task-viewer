import { setIcon, type App, type Menu, type WorkspaceLeaf } from 'obsidian';
import { t } from '../../i18n';
import type TaskViewerPlugin from '../../main';
import type { TaskReadService } from '../../services/data/TaskReadService';
import type { PinnedListDefinition, AstronomyDisplay } from '../../types';
import { VIEW_META_CALENDAR } from '../../constants/viewRegistry';
import { DateNavigator, ViewSettingsMenu, MaskToggleButton, ViewToolbarBase, type ViewSettingsOptions } from '../sharedUI/ViewToolbar';
import { DateLabel } from '../sharedUI/DateLabel';
import { appendAstronomyMenuSection } from '../sharedUI/AstronomyMenuSection';
import { FilterMenuComponent } from '../customMenus/FilterMenuComponent';
import { updateSidebarToggleButton } from '../sidebar/SidebarToggleButton';
import type { TaskLinkInteractionManager } from '../taskcard/TaskLinkInteractionManager';
import type { TaskViewHoverParent } from '../taskcard/TaskViewHoverParent';
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

    getReferenceMonth: () => { year: number; month: number };
    linkInteractionManager: TaskLinkInteractionManager;
    hoverParent: TaskViewHoverParent;
}

/**
 * Persistent toolbar for CalendarView.
 */
export class CalendarToolbar extends ViewToolbarBase {
    private sidebarToggleBtn: HTMLButtonElement | null = null;
    private dateLabelHandle: { update: (year: number, month: number) => void } | null = null;
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

        // Date Label (YYYY - MM)
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

        this.maskHandle = MaskToggleButton.render(actionZone, {
            getMaskMode: () => deps.getMaskMode(),
            setMaskMode: (next) => deps.setMaskMode(next),
        });

        ViewSettingsMenu.renderButton(actionZone, this.getSettingsOptions());

        // More button (compact mode — ⋮)
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

        // Sidebar toggle — always visible (outside action zone)
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

    private getSettingsOptions(): ViewSettingsOptions {
        const { deps } = this;
        return {
            app: deps.app,
            leaf: deps.leaf,
            getCustomName: () => deps.getCustomName(),
            getDefaultName: () => VIEW_META_CALENDAR.displayText,
            onRename: (newName) => deps.onRename(newName),
            buildUri: () => ({
                configParams: this.codec.toUriParams(deps.getCurrentConfig()),
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
        const ref = this.deps.getReferenceMonth();
        this.dateLabelHandle?.update(ref.year, ref.month);
        this.maskHandle?.update();
        this.syncSidebarToggleState();
    }
}
