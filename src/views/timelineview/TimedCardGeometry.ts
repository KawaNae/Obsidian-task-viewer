/**
 * The lengths of a timed card in a Timeline day column that the stylesheet
 * decides and the layout has to know. CSS cannot hand them over (a
 * container query's condition reads no custom property), so each is copied
 * here once, next to the rule it pairs with. Change one side, change both.
 */

/**
 * What the lane takes off the column's width for its cards: 4px on each
 * side (`TimelineSectionRenderer.placeInLane` writes the card's width as
 * `calc((100% - 8px) * f)` and its left as `calc(4px + (100% - 8px) * f)`,
 * and `measureLane` takes the same off the column's width).
 */
export const LANE_INSET_PX = 8;

/**
 * What a card's height leaves of its duration, so that two cards in a row
 * show a gap: `--task-card-real-height` in `_task-card.css`,
 * `max(2px, duration * hour height / 60 - 3px)`.
 */
const CARD_HEIGHT_INSET_PX = 3;
const CARD_MIN_HEIGHT_PX = 2;

/**
 * How much lower than its start minute at the lane's scale a card is drawn:
 * `_task-card.css` places a timed card at `calc(var(--start-minutes) *
 * var(--hour-height) / 60 + 1px)`. Between two cards the shift cancels
 * out; at the lane's top and bottom it does not.
 */
export const CARD_DRAWN_LOWER_PX = 1;

/**
 * What the lane the cards are placed in is shorter than its day: a day
 * column is `calc(24 * var(--hour-height))` tall with a 1px border at its
 * top and at its bottom (`_timeline-grid.css`), the borders inside that
 * height (`box-sizing: border-box`, `_base.css`), and its cards are placed
 * inside the borders.
 */
const LANE_BORDERS_PX = 2;

/** The height of a day's lane, inside the column's borders, `pxPerMinute` to a minute. */
export function laneHeightPx(pxPerMinute: number): number {
    return 24 * 60 * pxPerMinute - LANE_BORDERS_PX;
}

/**
 * Below this height a card shows its name in a band of its own height,
 * hanging below it: `@container tv-timed-card (height < 22px)` and
 * `--task-card-floor-height` in `_task-card.css`.
 */
export const NAME_BAND_BELOW_PX = 22;
export const NAME_BAND_HEIGHT_PX = 22;

/**
 * Up to this height a card shows no time row above its name:
 * `@container tv-timed-card (height <= 32px)` in `_task-card.css`.
 */
const TIME_ROW_UP_TO_PX = 32;

/**
 * From a card's top to the bottom of its name's first line, with the time
 * row above it: 2px of padding, the time row's room (`.task-card__content`'s
 * `margin-top: calc(0.8em - 2px)`, 8.8px), the list item's 5px margin and
 * one line. Measured on a card, not computed: the line follows the font.
 */
const NAME_ROW_WITH_TIME_PX = 34.8;

/**
 * The same with no time row: the container query sets the content's
 * `margin-top` to 0, which takes the 8.8px of the time row's room off the
 * measured 34.8px.
 */
const NAME_ROW_WITHOUT_TIME_PX = 26;

/**
 * What a card keeps below its name's first line when a name band above it
 * moves its content down: `--task-card-content-shift` in `_task-card.css`
 * stops at the card's height less 2px less where that line ends.
 */
export const CONTENT_SHIFT_FOOT_PX = 2;

/** The height a card of `durationMinutes` is drawn at, `pxPerMinute` to a minute. */
export function cardHeightPx(durationMinutes: number, pxPerMinute: number): number {
    return Math.max(CARD_MIN_HEIGHT_PX, durationMinutes * pxPerMinute - CARD_HEIGHT_INSET_PX);
}

/**
 * From the top of a card of `durationMinutes` to the bottom of its name's
 * first line, `pxPerMinute` to a minute: a card that starts above that lies
 * over the name.
 */
export function nameRowHeightPx(durationMinutes: number, pxPerMinute: number): number {
    const height = cardHeightPx(durationMinutes, pxPerMinute);
    if (height < NAME_BAND_BELOW_PX) return NAME_BAND_HEIGHT_PX;
    if (height <= TIME_ROW_UP_TO_PX) return NAME_ROW_WITHOUT_TIME_PX;
    return NAME_ROW_WITH_TIME_PX;
}
