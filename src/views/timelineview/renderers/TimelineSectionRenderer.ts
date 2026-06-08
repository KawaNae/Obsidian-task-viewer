import { t } from '../../../i18n';
import type { DisplayTask } from '../../../types';
import TaskViewerPlugin from '../../../main';
import { MenuHandler } from '../../../interaction/menu/MenuHandler';
import { TouchLongPressBinder } from '../../../interaction/menu/TouchLongPressBinder';
import { DateUtils } from '../../../utils/DateUtils';
import { TaskStyling } from '../../sharedUI/TaskStyling';
import { TaskLayout } from '../TaskLayout';
import { TaskCardRenderer } from '../../taskcard/TaskCardRenderer';
import { HandleManager } from '../HandleManager';
import { CardReconciler } from '../../sharedUI/CardReconciler';
import { CreateTaskModal, formatTaskLine } from '../../../modals/CreateTaskModal';
import { attachSunIndicators } from '../../sharedUI/AstronomyCellAdorner';


const Z_GAP = 10;
const SELECTED_Z_INDEX = 200;
const Z_MAX = SELECTED_Z_INDEX - Z_GAP;

export class TimelineSectionRenderer {
    constructor(
        private plugin: TaskViewerPlugin,
        private menuHandler: MenuHandler,
        private handleManager: HandleManager,
        private taskRenderer: TaskCardRenderer,
        private getZoomLevel: () => number,
        private viewId: string
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
        const layout = TaskLayout.calculateTaskLayout(timedTasks, date, startHour);

        timedTasks.forEach((task, index) => {
            if (!task.effectiveStartTime) return;

            const cardInstanceId = `${this.viewId}::lane-${date}::${task.id}`;
            const reused = reconciler.acquire(cardInstanceId);
            const el = reused ?? container.createDiv('task-card');
            if (reused) container.appendChild(reused);

            this.decorateLane(el, task, date, index, layout, startHour);

            this.taskRenderer.render(el, task, this.plugin.settings, {
                cardInstanceId,
            });
            // addTaskContextMenu is idempotent (WeakSet-guarded) so re-calling
            // on a reused element is a no-op, but skip the call to keep the
            // hot path tight.
            if (!reused) this.menuHandler.addTaskContextMenu(el, task);
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
        date: string,
        index: number,
        layout: ReturnType<typeof TaskLayout.calculateTaskLayout>,
        startHour: number,
    ): void {
        // Selection class is owned by HandleManager; sync it from authoritative state.
        el.toggleClass('is-selected', task.id === this.handleManager.getSelectedTaskId());

        // Reset + apply split-segment variant classes (idempotent).
        TaskStyling.applySplitClasses(el, task);

        if (task.isSplit && task.originalTaskId) {
            el.dataset.splitOriginalId = task.originalTaskId;
        } else {
            delete el.dataset.splitOriginalId;
        }

        el.dataset.id = task.id;

        TaskStyling.applyTaskColor(el, task.color ?? null);
        TaskStyling.applyTaskLinestyle(el, task.linestyle ?? null);
        TaskStyling.applyReadOnly(el, task);

        // Position math (mirrors the previous in-line code; isolated here for
        // tidy reuse on reconciled elements).
        let startMinutes = DateUtils.timeToMinutes(task.effectiveStartTime!);
        let endMinutes: number;

        if (task.effectiveEndTime) {
            if (task.effectiveEndTime.includes('T')) {
                const startDate = new Date(`${date}T00:00:00`);
                const endDate = new Date(task.effectiveEndTime);
                const diffMs = endDate.getTime() - startDate.getTime();
                endMinutes = Math.floor(diffMs / 60000);
            } else {
                endMinutes = DateUtils.timeToMinutes(task.effectiveEndTime);
                if (endMinutes < startMinutes) {
                    endMinutes += 24 * 60;
                }
            }
        } else {
            endMinutes = startMinutes + DateUtils.DEFAULT_TIMED_DURATION_MINUTES;
        }

        const startHourMinutes = startHour * 60;
        if (startMinutes < startHourMinutes) {
            startMinutes += 24 * 60;
            endMinutes += 24 * 60;
        }

        const relativeStart = startMinutes - startHourMinutes;
        const duration = endMinutes - startMinutes;

        const taskLayout = layout.get(task.id) || { width: 100, left: 0, zIndex: 1 };
        const widthFraction = taskLayout.width / 100;
        const leftFraction = taskLayout.left / 100;

        el.style.setProperty('--start-minutes', String(relativeStart));
        el.style.setProperty('--duration-minutes', String(duration));
        el.style.width = `calc((100% - 8px) * ${widthFraction})`;
        el.style.left = `calc(4px + (100% - 8px) * ${leftFraction})`;
        el.style.zIndex = String(Math.min(index * Z_GAP + taskLayout.zIndex, Z_MAX));

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
        const timeString = `${finalHours.toString().padStart(2, '0')}:${roundedMinutes.toString().padStart(2, '0')}`;

        // Determine Task Date
        // If finalHours + 24 (effectively) was >= 24, it means it's next day
        // Wait, 'finalHours' is normalized 0-23. 
        // We can check totalMinutes vs 24*60
        // Or check rawTotalMinutes

        let taskDate = date;
        if (rawTotalMinutes >= 24 * 60) {
            // It's the next day
            const d = new Date(date);
            // Fix timezone for date calc
            const [y, m, day] = date.split('-').map(Number);
            d.setFullYear(y, m - 1, day);
            d.setDate(d.getDate() + 1);
            taskDate = DateUtils.getLocalDateString(d);
        }

        // Open Modal
        new CreateTaskModal(this.plugin.app, async (result) => {
            const taskLine = formatTaskLine(result);

            // date is the FILE date (visual column date)
            const [y, m, d] = date.split('-').map(Number);
            const dateObj = new Date();
            dateObj.setFullYear(y, m - 1, d);
            dateObj.setHours(0, 0, 0, 0);

            const { DailyNoteUtils } = await import('../../../utils/DailyNoteUtils');
            await DailyNoteUtils.appendLineToDailyNote(
                this.plugin.app,
                dateObj,
                taskLine,
                this.plugin.settings.dailyNoteHeader,
                this.plugin.settings.dailyNoteHeaderLevel
            );
        }, { startDate: taskDate, startTime: timeString }, { warnOnEmptyTask: true, dailyNoteDate: date, startHour: this.plugin.settings.startHour }).open();
    }

    /** Show context menu for empty space click */
    private showEmptySpaceMenu(x: number, y: number, offsetY: number, date: string) {
        this.plugin.menuPresenter.present((menu) => {
            // Create new Task
            menu.addItem((item) => {
                item.setTitle(t('menu.createTaskForDailyNote'))
                    .setIcon('plus')
                    .onClick(() => this.handleCreateTaskTrigger(offsetY, date));
            });

            menu.addSeparator();

            // Open Countup (Daily Note)
            menu.addItem((item) => {
                item.setTitle(t('menu.openCountupForDailyNote'))
                    .setIcon('clock')
                    .onClick(() => this.openDailyNoteTimer(date, 'countup'));
            });

            // Open Pomodoro (Daily Note)
            menu.addItem((item) => {
                item.setTitle(t('menu.openPomodoroForDailyNote'))
                    .setIcon('timer')
                    .onClick(() => this.openDailyNoteTimer(date, 'pomodoro'));
            });
        }, { kind: 'position', x, y });
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
