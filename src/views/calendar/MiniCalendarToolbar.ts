import { setIcon } from 'obsidian';
import { t } from '../../i18n';
import { DateNavigator, ViewToolbarBase, ViewSettingsMenu, editViewFilter } from '../sharedUI/ViewToolbar';
import { DateLabel } from '../sharedUI/DateLabel';
import { appendAstronomyMenuSection } from '../sharedUI/AstronomyMenuSection';
import { FilterMenuComponent } from '../customMenus/FilterMenuComponent';
import type { TaskLinkInteractionManager } from '../taskcard/TaskLinkInteractionManager';
import type { TaskViewHoverParent } from '../taskcard/TaskViewHoverParent';
import type { ViewToolbarContext } from '../base/TaskViewerView';
import type { MiniCalendarState } from './MiniCalendarSchema';

/** What MiniCalendar does that is not a change of its state, or reads from more than it. */
export interface MiniCalendarCommands {
    /** Slide the grid by `n` weeks. */
    navigateWeeks(n: number): void;
    /** Follow today again: today's month grid. */
    today(): void;
    /** The month the grid is read as. */
    referenceMonth(): { year: number; month: number };
}

export interface MiniCalendarToolbarDeps {
    context: ViewToolbarContext<MiniCalendarState>;
    commands: MiniCalendarCommands;
    linkInteractionManager: TaskLinkInteractionManager;
    hoverParent: TaskViewHoverParent;
}

/**
 * Persistent toolbar for MiniCalendarView. It reads and writes the view's
 * store and mends itself when the store changes.
 */
export class MiniCalendarToolbar extends ViewToolbarBase {
    private dateLabelHandle: { update: (year: number, month: number) => void } | null = null;
    private readonly filterMenu: FilterMenuComponent;

    constructor(private deps: MiniCalendarToolbarDeps) {
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

    protected override buildDom(toolbar: HTMLElement): void {
        const { context, commands } = this.deps;

        const dateLabelDeps = {
            app: context.app,
            getSettings: () => context.plugin.settings,
            notes: context.plugin.getOperations(),
            linkInteractionManager: this.deps.linkInteractionManager,
            hoverParent: this.deps.hoverParent,
        };
        this.dateLabelHandle = DateLabel.render(toolbar, dateLabelDeps);
        const ref = commands.referenceMonth();
        this.dateLabelHandle.update(ref.year, ref.month);
        DateLabel.bindHoverPreview(toolbar, dateLabelDeps);

        toolbar.createDiv('view-toolbar__spacer');

        DateNavigator.render(
            toolbar,
            (weeks) => commands.navigateWeeks(weeks),
            () => commands.today(),
            { vertical: true }
        );

        const moreBtn = toolbar.createEl('button', { cls: 'view-toolbar__btn--icon view-toolbar__btn--more' });
        setIcon(moreBtn, 'more-vertical');
        moreBtn.setAttribute('aria-label', t('toolbar.viewSettings'));

        moreBtn.onclick = (e) => {
            context.plugin.menuPresenter.present((menu) => {
                menu.addItem((item) => {
                    item.setTitle(t('toolbar.filter'))
                        .setIcon('filter')
                        .onClick(() => editViewFilter(
                            this.filterMenu, { element: moreBtn }, this.store,
                            () => context.plugin.getIndex().getTasks(),
                        ));
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
                overlays: ['moonPhase'],
                settings: context.plugin.settings.astronomy,
                instance: this.store.get().astronomyDisplay,
                onChange: (next) => this.store.update({ astronomyDisplay: next }),
            });
        });
    }

    override update(): void {
        if (!this.rootEl) return;
        const ref = this.deps.commands.referenceMonth();
        this.dateLabelHandle?.update(ref.year, ref.month);
    }
}
