import TaskViewerPlugin from '../../main';
import { t } from '../../i18n';
import { MenuHandler } from '../../interaction/menu/MenuHandler';
import { TouchLongPressBinder } from '../../interaction/menu/TouchLongPressBinder';
import { TaskStyling } from './TaskStyling';
import { TaskCardRenderer } from '../taskcard/TaskCardRenderer';
import { HandleManager } from '../timelineview/HandleManager';
import { DisplayTask } from '../../types';
import { CreateTaskModal, formatTaskLine } from '../../modals/CreateTaskModal';
import { computeGridLayout, GridTaskEntry } from '../sharedLogic/GridTaskLayout';
import { renderDueArrow } from './DueArrowRenderer';
import { splitTasks } from '../../services/display/TaskSplitter';
import { getTaskDateRange } from '../../services/display/VisualDateRange';
import { getOriginalTaskId } from '../../services/display/DisplayTaskConverter';

export class AllDaySectionRenderer {
    constructor(
        private plugin: TaskViewerPlugin,
        private menuHandler: MenuHandler,
        private handleManager: HandleManager,
        private taskRenderer: TaskCardRenderer,
        private getDaysToShow: () => number,
        private viewId: string
    ) { }

    public render(container: HTMLElement, dates: string[], displayTasks: DisplayTask[]) {
        const viewStart = dates[0];
        const viewEnd = dates[dates.length - 1];
        const startHour = this.plugin.settings.startHour;

        // セクション分類は GridRenderer 側で `bucketBySection` 済み (SectionClassifier)。
        // ここでは visual date range が view 範囲と重なるかだけを確認する。
        const tasks = displayTasks.filter(dt => {
            if (!dt.effectiveStartDate) return false;
            const range = getTaskDateRange(dt, startHour);
            const visualStart = range.effectiveStart || dt.effectiveStartDate;
            const tEnd = range.effectiveEnd || visualStart;
            return visualStart <= viewEnd && tEnd >= viewStart;
        });

        // AllDay lane は 1 行が連続しており、week 境界は **物理的に分かれない**。
        // そのため task は view 全体に対して 1 つの DOM (gridColumn span N) で
        // 表現されるべきで、内部 split は必要ない。view 端を跨ぐ場合のみ
        // continues-before/after の clip が立つ。
        const splitResult = splitTasks(tasks, {
            type: 'date-range', start: viewStart, end: viewEnd, startHour,
        });

        // Use shared layout engine
        const entries = computeGridLayout(splitResult, {
            dates,
            getDateRange: (task) => {
                const dt = task as DisplayTask;
                if (!dt.effectiveStartDate) return null;
                const range = getTaskDateRange(dt, startHour);
                if (!range.effectiveStart) return null;
                return {
                    effectiveStart: range.effectiveStart,
                    effectiveEnd: range.effectiveEnd || range.effectiveStart,
                };
            },
            computeDueArrows: true,
        });

        // Grid offsets: col 1 = time axis, row 1 = padding
        const gridColOffset = 1;
        const gridRowOffset = 2;

        for (const entry of entries) {
            this.renderTaskCard(container, entry, gridColOffset, gridRowOffset);

            if (entry.dueArrow) {
                renderDueArrow(container, entry, {
                    gridRowOffset,
                    gridColOffset,
                });
            }
        }
    }

    private renderTaskCard(
        container: HTMLElement,
        entry: GridTaskEntry,
        gridColOffset: number,
        gridRowOffset: number
    ): void {
        const { task } = entry;

        const el = container.createDiv('task-card task-card--allday');
        el.createDiv('task-card__shape');
        if (entry.isMultiDay) {
            el.addClass('task-card--multi-day');
        }
        if (entry.continuesBefore) el.addClass('task-card--split-continues-before');
        if (entry.continuesAfter) el.addClass('task-card--split-continues-after');

        // split segment は base task の id とは別の segment id を持つため、
        // selection 照合 (HandleManager) には base id (`originalTaskId`) を
        // `dataset.splitOriginalId` として併せて公開する。これがないと
        // segment cards に `.is-selected` も handles も attach されない。
        const originalTaskId = getOriginalTaskId(task);
        el.dataset.id = task.id;
        if (entry.continuesBefore || entry.continuesAfter) {
            el.dataset.splitOriginalId = originalTaskId;
        }
        if (originalTaskId === this.handleManager.getSelectedTaskId()) {
            el.addClass('is-selected');
        }

        TaskStyling.applyTaskColor(el, task.color ?? null);
        TaskStyling.applyTaskLinestyle(el, task.linestyle ?? null);
        TaskStyling.applyReadOnly(el, task);

        // Each split segment gets its own cardInstanceId via segmentId so a
        // task spanning multiple days can be expanded independently per row.
        this.taskRenderer.render(el, task, this.plugin.settings, {
            cardInstanceId: `${this.viewId}::allday::${entry.segmentId}`,
            topRight: 'none',
            compact: true,
        });
        this.menuHandler.addTaskContextMenu(el, task);

        // Grid 座標を dataset で公開し、drag move/resize が style.gridColumn の
        // regex parse を経ずに済むようにする。calendar card と命名対称。
        // colStart は dates 配列内 0-based (calendar は week-row 内 1-based) で
        // 意味は parent コンテキスト依存。drag 側は parent ごとに colOffset を
        // 加算する設計に閉じ込めることで衝突しない。
        el.dataset.colStart = String(entry.colStart);
        el.dataset.span = String(entry.span);
        el.dataset.trackIndex = String(entry.trackIndex);

        el.style.gridColumn = `${entry.colStart + gridColOffset} / span ${entry.span}`;
        el.style.gridRow = `${entry.trackIndex + gridRowOffset}`;
        el.style.zIndex = '10';
    }

    /** Add context menu listeners to AllDay section cell */
    public addEmptySpaceContextMenu(cell: HTMLElement, date: string) {
        TouchLongPressBinder.bind(cell, {
            getThreshold: () => this.plugin.settings.longPressThreshold,
            targetCheck: (t) => t === cell,
            onLongPress: (x, y) => this.showEmptySpaceMenu(x, y, date),
            onContextMenu: (e) => this.showEmptySpaceMenu(e.pageX, e.pageY, date),
        });
    }

    /** Show context menu for empty space click */
    private showEmptySpaceMenu(x: number, y: number, date: string) {
        this.plugin.menuPresenter.present((menu) => {
            // Create Task (All-Day type)
            menu.addItem((item) => {
                item.setTitle(t('menu.createTaskForDailyNote'))
                    .setIcon('plus')
                    .onClick(() => this.handleCreateTask(date));
            });

            menu.addSeparator();

            // Open Pomodoro (Daily Note)
            menu.addItem((item) => {
                item.setTitle(t('menu.openPomodoroForDailyNote'))
                    .setIcon('timer')
                    .onClick(() => this.openDailyNoteTimer(date, 'pomodoro'));
            });

            // Open Timer (Daily Note)
            menu.addItem((item) => {
                item.setTitle(t('menu.openCountupForDailyNote'))
                    .setIcon('clock')
                    .onClick(() => this.openDailyNoteTimer(date, 'countup'));
            });
        }, { kind: 'position', x, y });
    }

    /** Create an all-day task for the specified date */
    private handleCreateTask(date: string) {
        new CreateTaskModal(this.plugin.app, async (result) => {
            const taskLine = formatTaskLine(result);
            const [y, m, d] = date.split('-').map(Number);
            const dateObj = new Date();
            dateObj.setFullYear(y, m - 1, d);
            dateObj.setHours(0, 0, 0, 0);

            const { DailyNoteUtils } = await import('../../utils/DailyNoteUtils');
            await DailyNoteUtils.appendLineToDailyNote(
                this.plugin.app,
                dateObj,
                taskLine,
                this.plugin.settings.dailyNoteHeader,
                this.plugin.settings.dailyNoteHeaderLevel
            );
        }, { startDate: date }, { warnOnEmptyTask: true, dailyNoteDate: date, startHour: this.plugin.settings.startHour }).open();
    }

    /** Open timer for daily note */
    private openDailyNoteTimer(date: string, timerType: 'pomodoro' | 'countup') {
        const dailyNoteId = `daily-${date}`;
        const displayName = date;
        const widget = this.plugin.getTimerWidget();
        widget.startTimer({
            taskId: dailyNoteId,
            taskName: displayName,
            recordMode: 'child',
            timerType,
            autoStart: false
        });
    }
}
