import { t } from '../../../i18n';
import type { DisplayTask } from '../../../types';
import type { PluginContext } from '../../../PluginContext';
import type { TimerHost } from '../../../timer/TimerWidget';
import { TouchLongPressBinder } from '../../../interaction/menu/TouchLongPressBinder';
import { minutesOfSpan } from '../../../utils/DayWindow';
import { TaskStyling } from '../../sharedUI/TaskStyling';
import { TaskLayout, type LaneSlot } from '../TaskLayout';
import type { TaskCardRenderer } from '../../taskcard/TaskCardRenderer';
import { TIME_TOP_RIGHT } from '../../taskcard/TopRightFieldResolver';
import { markHandleSurface } from '../../sharedUI/handles/HandleSurface';
import type { CardReconciler } from '../../sharedUI/CardReconciler';
import {
    appendEmptySpaceMenuItems,
    openDraftHubForDailyNote,
    startDailyNoteTimer,
} from '../../sharedLogic/DailyNoteTaskActions';
import { attachSunIndicators } from '../../sharedUI/AstronomyCellAdorner';


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

        timedTasks.forEach(task => {
            if (!task.drawn) return;

            const key = { scope: `lane-${date}`, name: task.id };
            const reused = reconciler.acquire(key, task);
            const el = reused ?? container.createDiv('task-card');
            markHandleSurface(el, 'timeline');
            if (reused) container.appendChild(reused);

            this.decorateLane(el, task, layout, startHour);

            this.taskRenderer.render(el, task, this.plugin.settings, {
                key,
                topRight: { mode: 'fields', config: TIME_TOP_RIGHT },
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
        layout: Map<string, LaneSlot>,
        startHour: number,
    ): void {
        // Reset + apply split-segment variant classes (idempotent).
        TaskStyling.applySplitClasses(el, task);

        // Position: what the card is drawn over, in minutes of its visual day,
        // the same minutes TaskLayout places cards by.
        const { start: relativeStart, end: endMinutes } = minutesOfSpan(task.drawn!, startHour);
        const duration = endMinutes - relativeStart;

        const taskLayout = layout.get(task.id) || { width: 100, left: 0, rank: 1 };
        const widthFraction = taskLayout.width / 100;
        const leftFraction = taskLayout.left / 100;

        el.style.setProperty('--start-minutes', String(relativeStart));
        el.style.setProperty('--duration-minutes', String(duration));
        el.style.width = `calc((100% - 8px) * ${widthFraction})`;
        el.style.left = `calc(4px + (100% - 8px) * ${leftFraction})`;
        // The rank is the card's place in front of the day's other cards
        // (TaskLayout); the z-index is CSS's, the rank capped under the
        // selected card (`.task-card`, ladder [B] in _variables.css).
        el.style.setProperty('--lane-z', String(taskLayout.rank));

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

        openDraftHubForDailyNote(this.plugin, date, (startHour * 60) + minutesFromStart);
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
