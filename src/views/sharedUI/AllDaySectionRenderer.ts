import type { PluginContext } from '../../PluginContext';
import type { TimerHost } from '../../timer/TimerWidget';
import { t } from '../../i18n';
import { TouchLongPressBinder } from '../../interaction/menu/TouchLongPressBinder';
import type { TaskCardRenderer } from '../taskcard/TaskCardRenderer';
import type { HandleManager } from './handles/HandleManager';
import { markHandleSurface } from './handles/HandleSurface';
import type { DisplayTask } from '../../types';
import {
    appendEmptySpaceMenuItems,
    openCreateTaskForDailyNote,
    startDailyNoteTimer,
} from '../sharedLogic/DailyNoteTaskActions';
import { computeGridLayout, type GridTaskEntry } from '../sharedLogic/GridTaskLayout';
import { renderDueArrow } from './DueArrowRenderer';
import { splitTasks } from '../../services/display/TaskSplitter';
import { getTaskDateRange } from '../../services/display/VisualDateRange';
import { getOriginalTaskId } from '../../services/display/DisplayTaskConverter';
import type { CardReconciler } from './CardReconciler';

const ALLDAY_VARIANT_CLASSES = [
    'task-card--multi-day',
    'task-card--split-continues-before',
    'task-card--split-continues-after',
];

export class AllDaySectionRenderer {
    constructor(
        private plugin: PluginContext & TimerHost,
        private handleManager: HandleManager,
        private taskRenderer: TaskCardRenderer,
    ) { }

    public render(
        container: HTMLElement,
        dates: string[],
        displayTasks: DisplayTask[],
        reconciler: CardReconciler,
    ): number {
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

        let maxTrack = 0;
        for (const entry of entries) {
            this.renderTaskCard(container, entry, gridColOffset, gridRowOffset, reconciler);
            if (entry.trackIndex >= maxTrack) maxTrack = entry.trackIndex + 1;

            if (entry.dueArrow) {
                renderDueArrow(container, entry, {
                    gridRowOffset,
                    gridColOffset,
                });
            }
        }
        return maxTrack;
    }

    private renderTaskCard(
        container: HTMLElement,
        entry: GridTaskEntry,
        gridColOffset: number,
        gridRowOffset: number,
        reconciler: CardReconciler,
    ): void {
        const { task } = entry;
        const key = { scope: 'allday', name: entry.segmentId };
        const reused = reconciler.acquire(key, task);
        const el = reused ?? container.createDiv('task-card task-card--allday');
        markHandleSurface(el, 'grid');
        if (reused) container.appendChild(reused);

        this.decorateAllDay(el, entry, gridColOffset, gridRowOffset);

        // Each split segment gets its own key via segmentId so a
        // task spanning multiple days can be expanded independently per row.
        this.taskRenderer.render(el, task as DisplayTask, this.plugin.settings, {
            key,
            topRight: { mode: 'none' },
            compact: true,
        });
    }

    /**
     * Idempotent allday-card decoration. Variant classes are reset before
     * applying. Dataset and grid-position style are unconditionally rewritten.
     */
    private decorateAllDay(
        el: HTMLElement,
        entry: GridTaskEntry,
        gridColOffset: number,
        gridRowOffset: number,
    ): void {
        const { task } = entry;

        // Reset variant classes; --allday is constant for this lane and stays.
        ALLDAY_VARIANT_CLASSES.forEach(cls => el.removeClass(cls));
        if (entry.useBarVariant) el.addClass('task-card--multi-day');
        if (entry.continuesBefore) el.addClass('task-card--split-continues-before');
        if (entry.continuesAfter) el.addClass('task-card--split-continues-after');

        // A split segment's id is not its task's: the selection holds the
        // task's (`originalTaskId`), which the handles find on the card's
        // hold (`CardHold.name`).
        const originalTaskId = getOriginalTaskId(task);
        el.toggleClass('is-selected', originalTaskId === this.handleManager.getSelectedTaskId());

        // Grid 座標を dataset で公開し、drag move/resize が style.gridColumn の
        // regex parse を経ずに済むようにする。calendar card と命名対称。
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
            appendEmptySpaceMenuItems(menu, {
                onCreate: () => openCreateTaskForDailyNote(this.plugin, date, { startDate: date }),
                onTimer: (kind) => startDailyNoteTimer(this.plugin, date, kind),
            });
        }, { kind: 'position', x, y });
    }
}
