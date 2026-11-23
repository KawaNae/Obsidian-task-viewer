import { t } from '../../../i18n';
import type { DisplayTask } from '../../../types';
import type { PluginContext } from '../../../PluginContext';
import type { TimerHost } from '../../../timer/TimerWidget';
import { TouchLongPressBinder } from '../../../interaction/menu/TouchLongPressBinder';
import { minutesOfSpan } from '../../../utils/DayWindow';
import { TaskStyling } from '../../sharedUI/TaskStyling';
import type { TimelineOverlapMode } from '../../../types';
import { TaskLayout, narrowestSideBySidePx, type LaneSlot, type TimelineLane } from '../TaskLayout';
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


/**
 * The lengths of the lane `measureLane` reads off a column and its
 * stylesheet, and the narrowest a card there shows its start and end time
 * whole (`fullTimePx`), which TaskLayout is given as the narrowest a column
 * put side by side may be under `auto`.
 */
type LaneLengths = Pick<TimelineLane, 'widthPx' | 'bandInsetPx' | 'haloBlockPx' | 'haloInlinePx'> & {
    fullTimePx: number;
};

const UNMEASURED: LaneLengths = { widthPx: 0, bandInsetPx: 0, haloBlockPx: 0, haloInlinePx: 0, fullTimePx: 0 };

/**
 * What a day column was drawn with, kept so that its cards can be placed
 * again (width, left, rank, halo, the gap to a name band above) without
 * being drawn again.
 */
interface DrawnLane {
    tasks: DisplayTask[];
    cards: Map<string, HTMLElement>;
}

/**
 * Draws a day column's timed cards, and places them again, without a draw,
 * where what decides their places changes while what they show does not:
 * the column's width (the pane resized), and the zoom once a wheel or a
 * pinch has finished changing it, which is not drawn while it changes.
 */
export class TimelineSectionRenderer {
    /** The columns of the last draw. */
    private readonly lanes = new Map<HTMLElement, DrawnLane>();
    /** The lane every column of the last draw is laid out in (`measureLane`). */
    private lengths: LaneLengths = UNMEASURED;
    /**
     * The column whose width is watched. Every day's column is as wide
     * (one grid track each), so the first stands for all.
     */
    private watched: HTMLElement | null = null;
    private readonly laneResize = this.createLaneObserver();

    /**
     * @param getOverlapMode the view's way of laying out overlapping cards,
     *   read as the cards are placed
     * @param measureFullTime the narrowest a card in a column shows its start
     *   and end time whole (`measureFullTimePx`); 0 where it cannot tell
     */
    constructor(
        private plugin: PluginContext & TimerHost,
        private taskRenderer: TaskCardRenderer,
        private getZoomLevel: () => number,
        private getOverlapMode: () => TimelineOverlapMode,
        private measureFullTime: (col: HTMLElement) => number,
    ) { }

    /**
     * Start a draw's columns, before their cards go in: forget the last
     * draw's, measure the lane once for all, and watch the first column's
     * width. A draw with no timed section passes none.
     */
    public beginLanes(cols: HTMLElement[]): void {
        this.lanes.clear();
        if (this.watched) this.laneResize.unobserve(this.watched);
        this.watched = cols[0] ?? null;
        this.lengths = this.watched ? this.measureAll(this.watched) : UNMEASURED;
        if (this.watched) this.laneResize.observe(this.watched);
    }

    /**
     * The stylesheet changed (a font, its size, a theme): measure every
     * length of the lane again, the width a card shows its times in with
     * them, and place every column's cards again if one differs. Such a
     * change leaves the column's width as it is, so no resize tells of it.
     */
    public measureLanesAgain(): void {
        if (!this.watched) return;
        const lengths = this.measureAll(this.watched);
        const keys = Object.keys(lengths) as (keyof LaneLengths)[];
        if (keys.every(key => lengths[key] === this.lengths[key])) return;
        this.lengths = lengths;
        this.placeLanesAgain();
    }

    private measureAll(col: HTMLElement): LaneLengths {
        return { ...this.measureLane(col), fullTimePx: this.measureFullTime(col) };
    }

    public render(
        container: HTMLElement,
        date: string,
        timedTasks: DisplayTask[],
        reconciler: CardReconciler,
        renderOptions: { showSunTimes: boolean } = { showSunTimes: false },
    ) {
        const startHour = this.plugin.settings.startHour;
        const lane: DrawnLane = { tasks: timedTasks, cards: new Map() };
        this.lanes.set(container, lane);

        // Calculate layout for overlapping tasks
        const layout = TaskLayout.calculateTaskLayout(timedTasks, startHour, this.lane());

        timedTasks.forEach(task => {
            if (!task.drawn) return;

            const key = { scope: `lane-${date}`, name: task.id };
            const reused = reconciler.acquire(key, task);
            const el = reused ?? container.createDiv('task-card');
            markHandleSurface(el, 'timeline');
            if (reused) container.appendChild(reused);
            lane.cards.set(task.id, el);

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
     * The lengths of a day's column as laid out now, for TaskLayout to tell
     * which cards a short card's name band lies over and how wide the cards
     * put side by side are: the width the cards' percentages are of, the
     * column's padding box less the lane's inset, unrounded (0 while the
     * column has no width, not laid out), where a band's halo
     * starts in from a card's left (the band's notch less the halo's
     * reach), how far the halo reaches past the top or bottom of a card or
     * its band, and how far it reaches left and right of a card, which the
     * cards put side by side stand apart; the last three read from the CSS
     * that draws them.
     */
    private measureLane(col: HTMLElement): Omit<LaneLengths, 'fullTimePx'> {
        const style = getComputedStyle(col);
        const px = (name: string) => parseFloat(style.getPropertyValue(name)) || 0;
        const haloInlinePx = px('--task-card-halo-inline');
        // The cards are placed absolutely in the column (`position:
        // relative`), so their 100% is the column's padding box, as wide as
        // laid out, a fraction of a px included. clientWidth rounds it to a
        // whole px, and a column put side by side at the narrowest its times
        // show whole in could then be drawn up to half a px narrower than
        // laid out here. The computed width is the box's laid-out width,
        // which no transform scales; it is the border box or the content box
        // by `box-sizing`, and 0 for a column not laid out (`auto`).
        const paddingBoxPx = style.getPropertyValue('box-sizing') === 'content-box'
            ? px('width') + px('padding-left') + px('padding-right')
            : px('width') - px('border-left-width') - px('border-right-width');
        return {
            widthPx: Math.max(0, paddingBoxPx - LANE_INSET_PX),
            bandInsetPx: px('--task-card-overflow-ext-offset') - haloInlinePx,
            haloBlockPx: px('--task-card-halo-block'),
            haloInlinePx,
        };
    }

    /**
     * Place the cards of every column drawn again, by the lane, the zoom and
     * the view's way of laying out as they are now, without drawing them.
     */
    public placeLanesAgain(): void {
        for (const [col, lane] of this.lanes) this.placeLane(col, lane);
    }

    /** Stop watching the columns' width. */
    public dispose(): void {
        this.laneResize.disconnect();
        this.lanes.clear();
        this.watched = null;
    }

    /**
     * The one place the observer of the columns' width is made, created in
     * the plugin's window as the view's other observers are.
     */
    private createLaneObserver(): ResizeObserver {
        return new ResizeObserver(() => this.laneResized());
    }

    /**
     * The watched column's width changed, or it was first laid out: measure
     * it again and, if the lane is another width, place every column's cards
     * again. A lane of the width the draw measured writes nothing: the width
     * is read off the column as laid out, so one layout reads one width,
     * fractions and all, and placing the cards leaves the column as wide.
     * The width a card shows its times in is kept once measured: a column's width does
     * not change the font its cards are drawn in, and this runs again and
     * again while a pane's edge is dragged. A column drawn before it was laid
     * out measured none, so it is measured as the column first has a width.
     */
    private laneResized(): void {
        if (!this.watched) return;
        const lengths = this.measureLane(this.watched);
        if (lengths.widthPx === this.lengths.widthPx) return;
        const fullTimePx = this.lengths.fullTimePx > 0 || lengths.widthPx === 0
            ? this.lengths.fullTimePx
            : this.measureFullTime(this.watched);
        this.lengths = { ...lengths, fullTimePx };
        this.placeLanesAgain();
    }

    /** Lay a column's cards out again and rewrite their places. */
    private placeLane(col: HTMLElement, lane: DrawnLane): void {
        const layout = TaskLayout.calculateTaskLayout(lane.tasks, this.plugin.settings.startHour, this.lane());
        for (const [id, el] of lane.cards) {
            const slot = layout.get(id);
            // A card the reconciler has since moved to another column is that column's.
            if (slot && el.parentElement === col) this.placeInLane(el, slot);
        }
    }

    /**
     * The lane TaskLayout lays a column's cards out in, made here alone for
     * a draw and for a placing again: the lengths measured last, and the
     * zoom and the view's way of laying out read as the cards are placed, so
     * it follows them as they are then. Under `auto` a cluster goes side by
     * side where each column shows its cards' start and end times whole.
     */
    private lane(): TimelineLane {
        const { fullTimePx, ...lengths } = this.lengths;
        return {
            ...lengths,
            // --hour-height is 60px a zoom step, so a minute is the zoom in px.
            pxPerMinute: this.getZoomLevel(),
            narrowestSideBySidePx: narrowestSideBySidePx(this.getOverlapMode(), fullTimePx),
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
        this.placeInLane(el, layout.get(task.id) ?? { width: 100, left: 0, rank: 1, liesOver: false, rightLiesOver: false });
    }

    /** The card's place across its lane and in front of the others, and its band's way, from TaskLayout. */
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
        // card's content moves down. Which band hangs there follows the
        // zoom, so the cards are placed again once a zoom rests; in minutes,
        // the gap keeps CSS right while a pinch goes on. Absent, nothing moves.
        if (slot.bandGap !== undefined) {
            el.style.setProperty('--band-gap-minutes', String(slot.bandGap));
        } else {
            el.style.removeProperty('--band-gap-minutes');
        }

        // A card with a card behind it in the room its halo takes traces
        // its outline past its left, top and bottom edges in the background
        // colour (TaskLayout). Which cards lie behind follows the zoom and
        // the lane's width, as for the right edge below.
        if (slot.liesOver) {
            el.dataset.cascadeOffset = '1';
        } else {
            delete el.dataset.cascadeOffset;
        }
        // The right edge of the card's body, and of its band, is traced too
        // where it lies over a card behind (TaskLayout). Which cards lie
        // behind follows the zoom and the lane's width, so a placing again
        // marks it or no more as a draw does.
        if (slot.rightLiesOver) {
            el.dataset.haloRight = '1';
        } else {
            delete el.dataset.haloRight;
        }
        if (slot.bandRightLiesOver) {
            el.dataset.bandHaloRight = '1';
        } else {
            delete el.dataset.bandHaloRight;
        }

        // The way a short card's name band hangs (TaskLayout), which follows
        // the zoom: CSS hangs it up from the card's bottom where marked, and
        // down from its top otherwise, as for a card with no band.
        if (slot.band === 'up') {
            el.dataset.band = 'up';
        } else {
            delete el.dataset.band;
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
