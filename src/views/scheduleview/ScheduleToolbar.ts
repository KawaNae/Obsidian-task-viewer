import { setIcon } from 'obsidian';
import { t } from '../../i18n';
import { DateNavigator, ViewSettingsMenu, MaskToggleButton, ViewToolbarBase, appendCompactFilterAndMask, editViewFilter } from '../sharedUI/ViewToolbar';
import { DateLabel } from '../sharedUI/DateLabel';
import { appendAstronomyMenuSection } from '../sharedUI/AstronomyMenuSection';
import { FilterMenuComponent } from '../customMenus/FilterMenuComponent';
import type { TaskLinkInteractionManager } from '../taskcard/TaskLinkInteractionManager';
import type { TaskViewHoverParent } from '../taskcard/TaskViewHoverParent';
import type { ViewToolbarContext } from '../base/TaskViewerView';
import type { ScheduleState } from './ScheduleSchema';

/** What Schedule does that is not a change of its state, or reads from more than it. */
export interface ScheduleCommands {
    /** Look at the day `n` days from the one looked at. */
    navigate(n: number): void;
    /** Follow today again and scroll to now. */
    today(): void;
    /** Look at `date`. */
    jumpToDate(date: string): void;
    /** The day drawn. */
    viewedDay(): string;
}

export interface ScheduleToolbarDeps {
    context: ViewToolbarContext<ScheduleState>;
    commands: ScheduleCommands;
    linkInteractionManager: TaskLinkInteractionManager;
    hoverParent: TaskViewHoverParent;
}

/**
 * Persistent toolbar for ScheduleView. It stands in the view's toolbar place
 * for the view's life, so the filter button (and any open popover) survive draws.
 * It reads and writes the view's store and mends itself when the store changes.
 */
export class ScheduleToolbar extends ViewToolbarBase {
    private dateLabelHandle: { update: (year: number, month: number) => void } | null = null;
    private maskHandle: { update: () => void } | null = null;
    private readonly filterMenu: FilterMenuComponent;

    constructor(private deps: ScheduleToolbarDeps) {
        super();
        this.filterMenu = new FilterMenuComponent(deps.context.app, () => deps.context.plugin.settings);
        deps.context.store.subscribe(() => this.update());
    }

    private get store() {
        return this.deps.context.store;
    }

    /** Close the popovers the toolbar opened. */
    override close(): void {
        this.filterMenu.close();
        super.close();
    }

    private getDateYearMonth(): { year: number; month: number } {
        const d = this.deps.commands.viewedDay();
        return { year: parseInt(d.substring(0, 4), 10), month: parseInt(d.substring(5, 7), 10) - 1 };
    }

    protected override buildDom(toolbar: HTMLElement): void {
        const { context, commands } = this.deps;

        // Date Label (YYYY - MM)
        const dateLabelDeps = {
            app: context.app,
            getSettings: () => context.plugin.settings,
            notes: context.plugin.getOperations(),
            linkInteractionManager: this.deps.linkInteractionManager,
            hoverParent: this.deps.hoverParent,
        };
        this.dateLabelHandle = DateLabel.render(toolbar, dateLabelDeps);
        const { year, month } = this.getDateYearMonth();
        this.dateLabelHandle.update(year, month);
        DateLabel.bindHoverPreview(toolbar, dateLabelDeps);

        DateNavigator.render(
            toolbar,
            (days) => commands.navigate(days),
            () => commands.today(),
            {
                dateJump: {
                    getCurrentDate: () => commands.viewedDay(),
                    onJump: (date) => commands.jumpToDate(date),
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
            editViewFilter(this.filterMenu, { event }, this.store, () => context.plugin.getIndex().getTasks());
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
            context.plugin.menuPresenter.present((menu) => {
                appendCompactFilterAndMask(menu, moreBtn, {
                    filterMenu: this.filterMenu,
                    store: this.store,
                    getTasks: () => context.plugin.getIndex().getTasks(),
                });
                menu.addSeparator();
                ViewSettingsMenu.appendItems(menu, this.settingsOptions());
            }, { kind: 'mouseEvent', event: e });
        };
    }

    private settingsOptions() {
        const { context } = this.deps;
        return context.settingsOptions((menu) => {
            appendAstronomyMenuSection(menu, {
                overlays: ['sunTimes', 'moonPhase'],
                settings: context.plugin.settings.astronomy,
                instance: this.store.get().astronomyDisplay,
                onChange: (next) => this.store.update({ astronomyDisplay: next }),
            });
        });
    }

    override update(): void {
        const { year, month } = this.getDateYearMonth();
        this.dateLabelHandle?.update(year, month);
        this.maskHandle?.update();
    }
}
