import { t } from '../../../i18n';
import type { DisplayTask } from '../../../types';
import type { PluginContext } from '../../../PluginContext';
import type { TimerHost } from '../../../timer/TimerWidget';
import { TouchLongPressBinder } from '../../../interaction/menu/TouchLongPressBinder';
import { minutesOfSpan } from '../../../utils/DayWindow';
import { TaskStyling } from '../../sharedUI/TaskStyling';
import { TaskLayout, type LaneGeometry, type LaneSlot } from '../TaskLayout';
import { LANE_INSET_PX } from '../TimedCardGeometry';
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
        renderOptions: { showSunTimes: boolean; lane?: LaneGeometry } = { showSunTimes: false },
    ) {
        const startHour = this.plugin.settings.startHour;

        // Calculate layout for overlapping tasks
        const layout = TaskLayout.calculateTaskLayout(timedTasks, startHour, renderOptions.lane);

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
     * The lane of a day's column as laid out now, for TaskLayout to tell
     * which cards a short card's name band lies over: the width the cards'
     * percentages are of, and where a band's halo starts in from a card's
     * sides (the band's notches less the halo's reach, read from the CSS
     * that draws them). Every day's column is as wide, so one is measured
     * per render. Undefined while the column has no width (not laid out).
     * The column's width can change without a render (the window resized);
     * what the cards were given then holds until the next render.
     */
    public measureLane(col: HTMLElement): LaneGeometry | undefined {
        const width = col.clientWidth - LANE_INSET_PX;
        if (width <= 0) return undefined;
        const style = getComputedStyle(col);
        const px = (name: string) => parseFloat(style.getPropertyValue(name)) || 0;
        return {
            width,
            bandInset: px('--task-card-overflow-ext-offset') - px('--task-card-halo-inline'),
        };
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

        el.style.setProperty('--start-minutes', String(relativeStart));
        el.style.setProperty('--duration-minutes', String(duration));
        this.placeInLane(el, layout.get(task.id) ?? { width: 100, left: 0, rank: 1, liesOver: false });
    }

    /** The card's place across its lane and in front of the others, from TaskLayout. */
    private placeInLane(el: HTMLElement, slot: LaneSlot): void {
        const inset = LANE_INSET_PX;
        el.style.width = `calc((100% - ${inset}px) * ${slot.width / 100})`;
        el.style.left = `calc(${inset / 2}px + (100% - ${inset}px) * ${slot.left / 100})`;
        // The rank is the card's place in front of the day's other cards
        // (TaskLayout); the z-index is CSS's, the rank capped under the
        // selected card (`.task-card`, ladder [B] in _variables.css).
        el.style.setProperty('--lane-z', String(slot.rank));
        // Minutes from the start of the card whose name band may hang over
        // this card's top (TaskLayout); CSS turns it into how far this
        // card's content moves down. It is in minutes, so a zoom needs no
        // rewrite. Absent, nothing moves.
        if (slot.bandGap !== undefined) {
            el.style.setProperty('--band-gap-minutes', String(slot.bandGap));
        } else {
            el.style.removeProperty('--band-gap-minutes');
        }

        // A card lying over another it overlaps in time traces its outline
        // over it in the background colour (the cascade halo). A card put
        // side by side to the right of another lies over none.
        if (slot.liesOver) {
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
