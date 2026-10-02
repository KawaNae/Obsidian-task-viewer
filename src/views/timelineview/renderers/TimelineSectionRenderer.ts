import { t } from '../../../i18n';
import type { DisplayTask } from '../../../types';
import type { PluginContext } from '../../../PluginContext';
import type { TimerHost } from '../../../timer/TimerWidget';
import { TouchLongPressBinder } from '../../../interaction/menu/TouchLongPressBinder';
import { DateUtils } from '../../../utils/DateUtils';
import { TaskStyling } from '../../sharedUI/TaskStyling';
import { TaskLayout } from '../TaskLayout';
import type { TaskCardRenderer } from '../../taskcard/TaskCardRenderer';
import { markHandleSurface } from '../../sharedUI/handles/HandleSurface';
import type { CardReconciler } from '../../sharedUI/CardReconciler';
import {
    appendEmptySpaceMenuItems,
    openCreateTaskForDailyNote,
    startDailyNoteTimer,
} from '../../sharedLogic/DailyNoteTaskActions';
import { attachSunIndicators } from '../../sharedUI/AstronomyCellAdorner';


// The gap between the ranks of successive cards in a lane. The z-index is
// CSS's: the rank capped under the selected card (`.task-card`, ladder [B]
// in _variables.css).
const Z_GAP = 10;

export class TimelineSectionRenderer {
    constructor(
        private plugin: PluginContext & TimerHost,
        private taskRenderer: TaskCardRenderer,
        private getZoomLevel: () => number,
    ) { }

    public render(
        container: HTMLElement,
        date: string,
        timedTasks: DisplayTask[],
        reconciler: CardReconciler,
        renderOptions: { showSunTimes: boolean } = { showSunTimes: false },
    ) {
        const startHour = this.plugin.settings.startHour;

        // Calculate layout for overlapping tasks
        const layout = TaskLayout.calculateTaskLayout(timedTasks, startHour);

        timedTasks.forEach((task, index) => {
            if (!task.effectiveStartTime) return;

            const key = { scope: `lane-${date}`, name: task.id };
            const reused = reconciler.acquire(key, task);
            const el = reused ?? container.createDiv('task-card');
            markHandleSurface(el, 'timeline');
            if (reused) container.appendChild(reused);

            this.decorateLane(el, task, index, layout, startHour);

            this.taskRenderer.render(el, task, this.plugin.settings, {
                key,
                topRight: { mode: 'time' },
            });
        });

        if (renderOptions.showSunTimes) {
            this.renderSunIndicators(container, date, startHour);
        }
    }

    /**
     * Append sunrise/sunset horizontal indicator lines for `date`. Thin
     * wrapper around the shared `attachSunIndicators` helper — kept as an
     * instance method so the call site reads `this.renderSunIndicators(...)`
     * consistently with the other private renderers on this class.
     */
    private renderSunIndicators(container: HTMLElement, date: string, startHour: number): void {
        const { latitude, longitude } = this.plugin.settings.astronomy.location;
        attachSunIndicators(container, date, { startHour, latitude, longitude });
    }

    /**
     * View-owned decoration for timed lane cards. Idempotent: every variant
     * class is cleared first, every dataset/style key is unconditionally
     * rewritten, so reuse cannot leave a stale value.
     */
    private decorateLane(
        el: HTMLElement,
        task: DisplayTask,
        index: number,
        layout: ReturnType<typeof TaskLayout.calculateTaskLayout>,
        startHour: number,
    ): void {
        // Reset + apply split-segment variant classes (idempotent).
        TaskStyling.applySplitClasses(el, task);

        // Position: the task's span in its visual day, the same one TaskLayout stacks by.
        const { start: startMinutes, end: endMinutes } =
            DateUtils.timedSpanMinutes(task.effectiveStartTime!, task.effectiveEndTime, startHour);
        const startHourMinutes = startHour * 60;

        const relativeStart = startMinutes - startHourMinutes;
        const duration = endMinutes - startMinutes;

        const taskLayout = layout.get(task.id) || { width: 100, left: 0, zIndex: 1 };
        const widthFraction = taskLayout.width / 100;
        const leftFraction = taskLayout.left / 100;

        el.style.setProperty('--start-minutes', String(relativeStart));
        el.style.setProperty('--duration-minutes', String(duration));
        el.style.width = `calc((100% - 8px) * ${widthFraction})`;
        el.style.left = `calc(4px + (100% - 8px) * ${leftFraction})`;
        el.style.setProperty('--lane-z', String(index * Z_GAP + taskLayout.zIndex));

        // cascade-offset: leftmost = unset, 重なって右にずれた card に '1'。
        if (taskLayout.left > 0) {
            el.dataset.cascadeOffset = '1';
        } else {
            delete el.dataset.cascadeOffset;
        }
    }

    /** Adds click/context listeners for creating new tasks. */
    public addCreateTaskListeners(col: HTMLElement, date: string) {
        TouchLongPressBinder.bind(col, {
            getThreshold: () => this.plugin.settings.longPressThreshold,
            targetCheck: (t) => t === col,
            onLongPress: (x, y) => {
                const rect = col.getBoundingClientRect();
                this.showEmptySpaceMenu(x, y, y - rect.top, date);
            },
            onContextMenu: (e) => {
                this.showEmptySpaceMenu(e.pageX, e.pageY, e.offsetY, date);
            },
        });
    }

    private handleCreateTaskTrigger(offsetY: number, date: string) {
        // Calculate time from offsetY
        const zoomLevel = this.getZoomLevel();
        const startHour = this.plugin.settings.startHour;

        // offsetY is in pixels. 1 hour = 60 * zoomLevel pixels
        const minutesFromStart = offsetY / zoomLevel;

        // Add startHour offset
        const rawTotalMinutes = (startHour * 60) + minutesFromStart;
        let totalMinutes = rawTotalMinutes;

        // Normalize to 0-23 hours
        if (totalMinutes >= 24 * 60) {
            totalMinutes -= 24 * 60;
        }

        const hours = Math.floor(totalMinutes / 60);
        const minutes = Math.floor(totalMinutes % 60);

        // Round to nearest 5 minutes for cleaner times
        let roundedMinutes = Math.round(minutes / 5) * 5;
        let finalHours = hours;

        if (roundedMinutes === 60) {
            roundedMinutes = 0;
            finalHours += 1;
        }

        // Normalize hours again just in case
        if (finalHours >= 24) {
            finalHours -= 24;
        }

        // Format time HH:mm
        const timeString = DateUtils.formatHHMM(finalHours, roundedMinutes);

        // Determine Task Date
        // If finalHours + 24 (effectively) was >= 24, it means it's next day
        // Wait, 'finalHours' is normalized 0-23. 
        // We can check totalMinutes vs 24*60
        // Or check rawTotalMinutes

        let taskDate = date;
        if (rawTotalMinutes >= 24 * 60) {
            // It's the next day
            taskDate = DateUtils.addDays(date, 1);
        }

        openCreateTaskForDailyNote(this.plugin, date, { startDate: taskDate, startTime: timeString });
    }

    /** Show context menu for empty space click */
    private showEmptySpaceMenu(x: number, y: number, offsetY: number, date: string) {
        this.plugin.menuPresenter.present((menu) => {
            appendEmptySpaceMenuItems(menu, {
                onCreate: () => this.handleCreateTaskTrigger(offsetY, date),
                onTimer: (kind) => startDailyNoteTimer(this.plugin, date, kind),
            });
        }, { kind: 'position', x, y });
    }
}
