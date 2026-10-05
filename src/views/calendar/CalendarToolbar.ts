import { setIcon } from 'obsidian';
import { t } from '../../i18n';
import { DateNavigator, ViewSettingsMenu, MaskToggleButton, ViewToolbarBase, appendCompactFilterAndMask, editViewFilter } from '../sharedUI/ViewToolbar';
import { DateLabel } from '../sharedUI/DateLabel';
import { appendAstronomyMenuSection } from '../sharedUI/AstronomyMenuSection';
import { FilterMenuComponent } from '../customMenus/FilterMenuComponent';
import { updateSidebarToggleButton } from '../sidebar/SidebarToggleButton';
import type { TaskLinkInteractionManager } from '../taskcard/TaskLinkInteractionManager';
import type { TaskViewHoverParent } from '../taskcard/TaskViewHoverParent';
import type { ViewToolbarHost } from '../base/TaskViewerView';
import type { CalendarState } from './CalendarSchema';

/** What Calendar does that is not a change of its state, or reads from more than it. */
export interface CalendarCommands {
    /** Move the grid by `n` weeks. */
    navigateWeeks(n: number): void;
    /** Follow today again: today's month grid. */
    today(): void;
    /** Look at `date`: its month grid, no offset. */
    goTo(date: string): void;
    /** The day looked at (today while following); the date picker opens on it. */
    viewedDay(): string;
    /** The month the grid is read as. */
    referenceMonth(): { year: number; month: number };
    /** Whether the sidebar shows (closed at narrow width until opened). */
    isSidebarOpen(): boolean;
    /** Open or close the sidebar, sliding. */
    toggleSidebar(open: boolean): void;
}

export interface CalendarToolbarDeps {
    host: ViewToolbarHost<CalendarState>;
    commands: CalendarCommands;
    linkInteractionManager: TaskLinkInteractionManager;
    hoverParent: TaskViewHoverParent;
}

/**
 * Persistent toolbar for CalendarView. Re-attached on each render via
 * mount/detach so the filter popover survives draws. It reads and writes the
 * view's store and mends itself when the store changes.
 */
export class CalendarToolbar extends ViewToolbarBase {
    private sidebarToggleBtn: HTMLButtonElement | null = null;
    private dateLabelHandle: { update: (year: number, month: number) => void } | null = null;
    private maskHandle: { update: () => void } | null = null;
    private readonly filterMenu: FilterMenuComponent;

    constructor(private deps: CalendarToolbarDeps) {
        super();
        this.filterMenu = new FilterMenuComponent(deps.host.app, () => deps.host.plugin.settings);
        deps.host.store.subscribe(() => this.update());
    }

    private get store() {
        return this.deps.host.store;
    }

    /** Close the popovers the toolbar opened. */
    override close(): void {
        this.filterMenu.close();
        super.close();
    }

    /** Synchronizes the sidebar toggle button with the view's sidebar state. */
    syncSidebarToggleState(): void {
        if (this.sidebarToggleBtn) {
            updateSidebarToggleButton(this.sidebarToggleBtn, this.deps.commands.isSidebarOpen());
        }
    }

    protected override buildDom(toolbar: HTMLElement): void {
        const { host, commands } = this.deps;

        // Date Label (YYYY - MM)
        const dateLabelDeps = {
            app: host.app,
            getSettings: () => host.plugin.settings,
            notes: host.plugin.getOperations(),
            linkInteractionManager: this.deps.linkInteractionManager,
            hoverParent: this.deps.hoverParent,
        };
        this.dateLabelHandle = DateLabel.render(toolbar, dateLabelDeps);
        const ref = commands.referenceMonth();
        this.dateLabelHandle.update(ref.year, ref.month);
        DateLabel.bindHoverPreview(toolbar, dateLabelDeps);

        DateNavigator.render(
            toolbar,
            (weeks) => commands.navigateWeeks(weeks),
            () => commands.today(),
            {
                vertical: true,
                dateJump: {
                    getCurrentDate: () => commands.viewedDay(),
                    onJump: (date) => commands.goTo(date),
                },
            }
        );

        toolbar.createDiv('view-toolbar__spacer');

        // Action zone (folded into ⋮ when the row does not fit)
        const actionZone = this.createActionZone(toolbar);

        const filterBtn = actionZone.createEl('button', { cls: 'view-toolbar__btn--icon' });
        setIcon(filterBtn, 'filter');
        filterBtn.setAttribute('aria-label', t('toolbar.filter'));
        filterBtn.addEventListener('click', (event: MouseEvent) => {
            editViewFilter(this.filterMenu, { event }, this.store, () => host.plugin.getIndex().getTasks());
        });

        this.maskHandle = MaskToggleButton.render(actionZone, {
            getMaskMode: () => this.store.get().maskMode ?? false,
            setMaskMode: (next) => this.store.update({ maskMode: next }),
        });

        ViewSettingsMenu.renderButton(actionZone, this.settingsOptions());

        // More button (⋮, shown while the action zone is folded)
        const moreBtn = toolbar.createEl('button', { cls: 'view-toolbar__btn--icon view-toolbar__btn--more' });
        setIcon(moreBtn, 'more-vertical');
        moreBtn.setAttribute('aria-label', t('toolbar.viewSettings'));

        moreBtn.onclick = (e) => {
            host.plugin.menuPresenter.present((menu) => {
                appendCompactFilterAndMask(menu, moreBtn, {
                    filterMenu: this.filterMenu,
                    store: this.store,
                    getTasks: () => host.plugin.getIndex().getTasks(),
                });
                menu.addSeparator();
                ViewSettingsMenu.appendItems(menu, this.settingsOptions());
            }, { kind: 'mouseEvent', event: e });
        };

        // Sidebar toggle — always visible (outside action zone)
        const toggleBtn = toolbar.createEl('button', {
            cls: 'view-toolbar__btn--icon sidebar-toggle-button-icon',
        });
        this.sidebarToggleBtn = toggleBtn;
        updateSidebarToggleButton(toggleBtn, commands.isSidebarOpen());
        toggleBtn.onclick = () => commands.toggleSidebar(!commands.isSidebarOpen());
    }

    private settingsOptions() {
        const { host } = this.deps;
        return host.settingsOptions((menu) => {
            appendAstronomyMenuSection(menu, {
                overlays: ['moonPhase'],
                settings: host.plugin.settings.astronomy,
                instance: this.store.get().astronomyDisplay,
                onChange: (next) => this.store.update({ astronomyDisplay: next }),
            });
        });
    }

    override update(): void {
        if (!this.rootEl) return;
        const ref = this.deps.commands.referenceMonth();
        this.dateLabelHandle?.update(ref.year, ref.month);
        this.maskHandle?.update();
        this.syncSidebarToggleState();
    }
}
