import type { DisplayTask, TaskViewerSettings, TimeOfDay } from '../../types';
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
 * The narrowest a timed card in `col` may be and still show its start and
 * its end time whole (`10:00>11:00`); 0 where the column is not laid out.
 *
 * A card's time row wraps between its units and drops the end whole when
 * the start and the end do not fit on its line (`renderTopRight`), so the
 * end shows where the card is as wide as the two units, plus the row's
 * inset from the card's sides and the card's side borders. The units are
 * drawn as a card in the column draws them, in a card put in the column for
 * the time it is measured, so they take the font and the size a card there
 * takes; the inset and the borders are read from that card's stylesheet.
 *
 * A font may give its digits widths of their own, so no one time stands for
 * all: each digit is drawn as `DD:DD` and `>DD:DD`, and the widest pair
 * taken, which holds for any time whose digits are no wider than the widest.
 */
export function measureFullTimePx(col: HTMLElement, settings: TaskViewerSettings): number {
    const probe = col.createDiv('task-card');
    probe.style.visibility = 'hidden';
    probe.style.pointerEvents = 'none';
    probe.style.height = `${PROBE_HEIGHT_PX}px`;
    try {
        const rows = DIGITS.map(d => {
            const time = `${d}${d}:${d}${d}` as TimeOfDay;
            const stand = { stated: { startTime: time, endTime: time } } as Pick<DisplayTask, 'stated'>;
            renderTopRight(probe, composeTopRight(stand as DisplayTask, TIME_TOP_RIGHT, settings));
            return probe.lastElementChild as HTMLElement;
        });
        const unitsPx = Math.max(...rows.map(row =>
            Array.from(row.children).reduce((sum, unit) => sum + unit.getBoundingClientRect().width, 0)));
        if (!(unitsPx > 0)) return 0;
        const px = (value: string) => parseFloat(value) || 0;
        const rowStyle = getComputedStyle(rows[0]);
        const cardStyle = getComputedStyle(probe);
        return unitsPx
            + px(rowStyle.left) + px(rowStyle.right)
            + px(cardStyle.borderLeftWidth) + px(cardStyle.borderRightWidth);
    } finally {
        probe.remove();
    }
}
