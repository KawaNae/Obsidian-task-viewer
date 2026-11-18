/**
 * Where Schedule scrolls its body to on today, in the running E2E vault: when
 * it opens on today and when its Now button is clicked, the now-line is at the
 * middle of what the body shows, the toolbar and the fixed rows above the body
 * taking nothing from it. An ancestor of the body made positioned does not
 * move it.
 *
 * The clock is fixed at twelve hours past the day's start, today, while the
 * view is drawn and read, so the line is far from both ends of the day and
 * the body can put it at its middle whatever the hour the suite is run at.
 *
 * Prerequisites:
 *   - Obsidian is running with the E2E vault open, with the current build
 *     loaded (the preflight builds it into the vault)
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/views/schedule-now.test.ts
 */
import { describe, it, expect, afterEach } from 'vitest';
import { PRELUDE, closeViews, ev, frames, openView, readSettings, visualDay } from '../helpers/view-helper';
import { UNTIL } from '../helpers/waits';

const NAME = 'sn-schedule';

interface NowReading {
    /** The body's scrollTop. */
    top: number;
    /** The largest scrollTop the body takes. */
    max: number;
    /** From the top of what the body shows to the now-line. */
    line: number;
    /** Half the height the body shows. */
    middle: number;
}

/**
 * Fix the clock at twelve hours past the day's start, today, and run `body`
 * (statements, with the prelude's names and `until`) with it fixed; then read
 * where the now-line lies in the body of the view NAME. The clock is put back
 * whatever happens.
 */
function withNoonClock(body: string): NowReading {
    const { startHour } = readSettings(['startHour']) as { startHour: number };
    const [y, m, d] = visualDay(startHour).split('-').map(Number);
    const fixed = new Date(y, m - 1, d, startHour + 12, 0, 0).getTime();
    return ev(`(async () => {
        ${PRELUDE}
        ${UNTIL}
        const RealDate = Date;
        const fixed = ${fixed};
        class FixedDate extends RealDate {
            constructor(...args) { if (args.length === 0) super(fixed); else super(...args); }
            static now() { return fixed; }
        }
        window.Date = FixedDate;
        try {
            ${body}
            const el = V(${JSON.stringify(NAME)}).contentEl;
            const area = el.querySelector('.schedule-view__body-scroll');
            const line = area?.querySelector('.schedule-grid__now-line');
            if (!line) throw new Error('no now-line');
            const top = area.getBoundingClientRect().top + area.clientTop;
            return JSON.stringify({
                top: area.scrollTop,
                max: area.scrollHeight - area.clientHeight,
                line: line.getBoundingClientRect().top - top,
                middle: area.clientHeight / 2,
            });
        } finally {
            window.Date = RealDate;
        }
    })()`);
}

/** Statements that open Schedule on today in a new leaf named NAME, and wait for its now-line. */
const OPEN_ON_TODAY = `
    if (R[${JSON.stringify(NAME)}]) { R[${JSON.stringify(NAME)}].detach(); await wait(100); }
    const leaf = app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: 'schedule-view', state: {}, active: true });
    R[${JSON.stringify(NAME)}] = leaf;
    await until(() => leaf.view.contentEl.querySelector('.schedule-grid__now-line'), 5000, 'the now-line');
    ${frames(3)}
`;

/** Statements that scroll the body of NAME to its start, click Now, and wait until the view has drawn again. */
const NOW_FROM_START = `
    const v = V(${JSON.stringify(NAME)});
    v.contentEl.querySelector('.schedule-view__body-scroll').scrollTop = 0;
    ${frames(2)}
    v.contentEl.querySelector('.schedule-view__body-scroll').dataset.tvRedrawMark = '1';
    nav(${JSON.stringify(NAME)}, 'today');
    await until(() => !v.contentEl.querySelector('[data-tv-redraw-mark]') && v.contentEl.querySelector('.schedule-grid__now-line'), 5000, 'the view drawn again after Now');
    ${frames(3)}
`;

/** The now-line is at the middle of what the body shows, the body scrolled away from both its ends. */
function expectMiddle(r: NowReading): void {
    expect(r.top).toBeGreaterThan(0);
    expect(r.top).toBeLessThan(r.max);
    expect(Math.abs(r.line - r.middle)).toBeLessThanOrEqual(1);
}

afterEach(async () => {
    await closeViews();
});

describe('Schedule scrolls the now-line to the middle of its body', () => {
    it('when it opens on today', () => {
        expectMiddle(withNoonClock(OPEN_ON_TODAY));
    });

    it('when its Now button is clicked, the body scrolled to its start', () => {
        openView(NAME, 'schedule-view', {});
        expectMiddle(withNoonClock(NOW_FROM_START));
    });

    it('when its Now button is clicked, the parent of the body made positioned', () => {
        openView(NAME, 'schedule-view', {});
        const r = withNoonClock(`
            const parent = V(${JSON.stringify(NAME)}).contentEl.querySelector('.schedule-view__body-scroll').parentElement;
            parent.style.position = 'relative';
            ${NOW_FROM_START}
            const grid = v.contentEl.querySelector('.schedule-grid__now-line').parentElement;
            if (grid.offsetParent !== parent) throw new Error('the grid does not count from the positioned parent');
        `);
        expectMiddle(r);
    });
});
