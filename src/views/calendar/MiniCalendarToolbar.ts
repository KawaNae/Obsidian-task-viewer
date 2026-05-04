import { setIcon, type App, type WorkspaceLeaf, type MenuItem } from 'obsidian';
import { t } from '../../i18n';
import type TaskViewerPlugin from '../../main';
import { DateUtils } from '../../utils/DateUtils';
import { DailyNoteUtils } from '../../utils/DailyNoteUtils';
import { TASK_VIEWER_HOVER_SOURCE_ID } from '../../constants/hover';
import { ViewToolbarBase } from '../sharedUI/ViewToolbar';
import { TaskLinkInteractionManager } from '../taskcard/TaskLinkInteractionManager';
import { TaskViewHoverParent } from '../taskcard/TaskViewHoverParent';
import { FilterMenuComponent } from '../customMenus/FilterMenuComponent';

export interface MiniCalendarToolbarDeps {
    app: App;
    leaf: WorkspaceLeaf;
    plugin: TaskViewerPlugin;
    filterMenu: FilterMenuComponent;
    linkInteractionManager: TaskLinkInteractionManager;
    hoverParent: TaskViewHoverParent;

    getReferenceMonth: () => { year: number; month: number };
    onNavigateWeek: (direction: number) => void;
    onJumpToCurrentMonth: () => void;
    onOpenPeriodicNote: (kind: 'yearly' | 'monthly', date: Date) => Promise<void>;
    onShowSettingsMenu: (event: MouseEvent, anchor: HTMLElement) => void;
}

/**
 * Persistent toolbar for MiniCalendarView.
 * Marked dynamic-content because year/month labels reflect the currently
 * displayed reference month and must rebuild on every render.
 */
export class MiniCalendarToolbar extends ViewToolbarBase {
    constructor(private deps: MiniCalendarToolbarDeps) {
        super({ dynamicContent: true });
    }

    protected override buildDom(toolbar: HTMLElement): void {
        const { deps } = this;
        const referenceMonth = deps.getReferenceMonth();
        const now = new Date();
        const isCurrentYear = referenceMonth.year === now.getFullYear();
        const isCurrentMonth = isCurrentYear && referenceMonth.month === now.getMonth();

        const labelGroup = toolbar.createDiv('mini-calendar-toolbar__label');

        const yearDate = new Date(referenceMonth.year, 0, 1);
        const yearLinkTarget = DailyNoteUtils.getYearlyNoteLinkTarget(deps.plugin.settings, yearDate);
        const yearWrapper = labelGroup.createSpan({ cls: 'mini-calendar-toolbar__year' });
        const yearLink = yearWrapper.createEl('a', {
            cls: 'internal-link',
            text: `${referenceMonth.year}`,
        });
        yearLink.dataset.href = yearLinkTarget;
        yearLink.setAttribute('href', yearLinkTarget);
        yearWrapper.toggleClass('is-current', isCurrentYear);
        yearLink.addEventListener('click', (event: MouseEvent) => {
            event.preventDefault();
        });
        deps.linkInteractionManager.bind(yearWrapper, {
            sourcePath: '',
            hoverSource: TASK_VIEWER_HOVER_SOURCE_ID,
            hoverParent: deps.hoverParent,
        }, { bindClick: false });
        yearWrapper.addEventListener('click', () => {
            void deps.onOpenPeriodicNote('yearly', yearDate);
        });

        labelGroup.createSpan({ cls: 'mini-calendar-toolbar__separator', text: '-' });

        const monthDate = new Date(referenceMonth.year, referenceMonth.month, 1);
        const monthLinkTarget = DailyNoteUtils.getMonthlyNoteLinkTarget(deps.plugin.settings, monthDate);
        const monthWrapper = labelGroup.createSpan({ cls: 'mini-calendar-toolbar__month' });
        const monthLink = monthWrapper.createEl('a', {
            cls: 'internal-link',
            text: `${String(referenceMonth.month + 1).padStart(2, '0')}`,
        });
        monthLink.dataset.href = monthLinkTarget;
        monthLink.setAttribute('href', monthLinkTarget);
        monthWrapper.toggleClass('is-current', isCurrentMonth);
        monthLink.addEventListener('click', (event: MouseEvent) => {
            event.preventDefault();
        });
        deps.linkInteractionManager.bind(monthWrapper, {
            sourcePath: '',
            hoverSource: TASK_VIEWER_HOVER_SOURCE_ID,
            hoverParent: deps.hoverParent,
        }, { bindClick: false });
        monthWrapper.addEventListener('click', () => {
            void deps.onOpenPeriodicNote('monthly', monthDate);
        });

        toolbar.createDiv('view-toolbar__spacer');
        const navGroup = toolbar.createDiv('mini-calendar-toolbar__nav');

        const prevBtn = navGroup.createEl('button', { cls: 'view-toolbar__btn--icon' });
        setIcon(prevBtn, 'chevron-up');
        prevBtn.setAttribute('aria-label', 'Previous week');
        prevBtn.addEventListener('click', () => deps.onNavigateWeek(-1));

        const todayBtn = navGroup.createEl('button', {
            cls: 'view-toolbar__btn--today mini-calendar-toolbar__today',
            text: t('toolbar.today'),
        });
        todayBtn.setAttribute('aria-label', 'Today');
        todayBtn.addEventListener('click', () => deps.onJumpToCurrentMonth());

        const nextBtn = navGroup.createEl('button', { cls: 'view-toolbar__btn--icon' });
        setIcon(nextBtn, 'chevron-down');
        nextBtn.setAttribute('aria-label', 'Next week');
        nextBtn.addEventListener('click', () => deps.onNavigateWeek(1));

        const moreBtn = toolbar.createEl('button', { cls: 'view-toolbar__btn--icon' });
        setIcon(moreBtn, 'more-vertical');
        moreBtn.setAttribute('aria-label', t('toolbar.viewSettings'));
        if (deps.filterMenu.hasActiveFilters()) {
            moreBtn.classList.add('is-filtered');
        }
        moreBtn.addEventListener('click', (e) => deps.onShowSettingsMenu(e, moreBtn));
    }
}
