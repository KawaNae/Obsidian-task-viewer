import type { DisplayTask, TaskViewerSettings, TimeOfDay } from '../../types';
import { drawTaskLineFrame } from '../taskcard/CardMarkdown';
import { renderTopRight } from '../taskcard/TaskCardRenderer';
import { TIME_TOP_RIGHT, composeTopRight } from '../taskcard/TopRightFieldResolver';

/**
 * Above the height up to which a timed card shows no time row
 * (`@container tv-timed-card (height <= 32px)` in `_task-card.css`), so the
 * row the probe measures is laid out.
 */
const PROBE_HEIGHT_PX = 64;

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

/**
 * What the narrowest legible card is made of, each length read off a card
 * in the column (`measureLegibleCardPx`).
 * - `timeUnitsPx`: the widest the start and the end of a time row take side
 *   by side, the two units' widths summed.
 * - `timeRowSidesPx`: how far the time row stands in from the card's left
 *   and right outer edges, summed: the row's inset and the card's borders.
 * - `nameBoxSidesPx`: how far the box a task's name is laid out in (the
 *   task's list item, right of its checkbox) stands in from the card's left
 *   and right outer edges, summed.
 */
export interface LegibleCardLengths {
    timeUnitsPx: number;
    timeRowSidesPx: number;
    nameBoxSidesPx: number;
}

/**
 * The narrowest a card may be for its time row to show the start and the
 * end whole and its name to have a box at least as wide as those two
 * units: the units with the wider of the two sides. The name's box lies
 * inside the time row's as the stylesheet lays them out today, so its sides
 * decide; taking the wider keeps the times whole should a stylesheet put
 * the name's box the further out. 0 where the units were not laid out.
 */
export function legibleCardPx({ timeUnitsPx, timeRowSidesPx, nameBoxSidesPx }: LegibleCardLengths): number {
    if (!(timeUnitsPx > 0)) return 0;
    return timeUnitsPx + Math.max(timeRowSidesPx, nameBoxSidesPx);
}

/**
 * The narrowest a timed card in `col` may be and still show its start and
 * its end time whole (`10:00>11:00`) and lay its name out in a box at least
 * as wide as those times (`legibleCardPx`); 0 where the column is not laid
 * out.
 *
 * A card's time row wraps between its units and drops the end whole when
 * the start and the end do not fit on its line (`renderTopRight`). The name
 * is laid out in the task's list item, which stands in from the card's
 * sides by the card's padding and the list's indent for its checkbox, so a
 * card just wide enough for the times wraps its name a character or two a
 * line. Both are read off a card put in the column for the time it is
 * measured, so they take the font, the size and the stylesheet a card
 * there takes: the units are drawn as a card draws them, and the name's
 * box is the frame of a task's line (`drawTaskLineFrame`) in the card's
 * body, as a card draws its body. The box measured is that of a card of one
 * task with a checkbox, unsplit, its children not counted.
 *
 * A font may give its digits widths of their own, so no one time stands for
 * all: each digit is drawn as `DD:DD` and `>DD:DD`, and the widest pair
 * taken, which holds for any time whose digits are no wider than the widest.
 */
export function measureLegibleCardPx(col: HTMLElement, settings: TaskViewerSettings): number {
    const probe = col.createDiv('task-card');
    probe.style.visibility = 'hidden';
    probe.style.pointerEvents = 'none';
    probe.style.height = `${PROBE_HEIGHT_PX}px`;
    // As wide as the column: a card placed in it with no width of its own
    // shrinks to its padding and its name's box to nothing, and the box's
    // distances from the card's sides are then those of no card drawn.
    probe.style.width = '100%';
    try {
        const rows = DIGITS.map(d => {
            const time = `${d}${d}:${d}${d}` as TimeOfDay;
            const stand = { stated: { startTime: time, endTime: time } } as Pick<DisplayTask, 'stated'>;
            renderTopRight(probe, composeTopRight(stand as DisplayTask, TIME_TOP_RIGHT, settings));
            return probe.lastElementChild as HTMLElement;
        });
        // The body as `TaskCardRenderer.render` puts it in the card.
        const nameBox = drawTaskLineFrame(probe.createDiv('task-card__content'));

        const timeUnitsPx = Math.max(...rows.map(row =>
            Array.from(row.children).reduce((sum, unit) => sum + unit.getBoundingClientRect().width, 0)));
        const px = (value: string) => parseFloat(value) || 0;
        const rowStyle = getComputedStyle(rows[0]);
        const cardStyle = getComputedStyle(probe);
        const card = probe.getBoundingClientRect();
        const box = nameBox.getBoundingClientRect();
        return legibleCardPx({
            timeUnitsPx,
            timeRowSidesPx: px(rowStyle.left) + px(rowStyle.right)
                + px(cardStyle.borderLeftWidth) + px(cardStyle.borderRightWidth),
            nameBoxSidesPx: (box.left - card.left) + (card.right - box.right),
        });
    } finally {
        probe.remove();
    }
}
