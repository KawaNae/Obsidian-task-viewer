/**
 * A card's own checkbox shows the status a click writes from the click on, in
 * the running Dev vault: the box's list item is marked `data-task="x"` before
 * the card is drawn again from the file, so the stylesheet's rule for `x`
 * colors the box with the task's color at once, as it does after the draw.
 * With the tick alone, Obsidian's rule for a checked box would draw it in the
 * theme's accent until the draw.
 *
 * The box's color is read with the global styles on (`applyGlobalStyles`),
 * which hold the per-status rules, and the note's `tv-color` red.
 *
 * Prerequisites:
 *   - Obsidian is running with the Dev vault (path in dev-paths.mjs) open
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/views/card-checkbox.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { isObsidianRunning } from '../helpers/cli-helper';
import { deleteTestFile, readTestFile, waitForFileDeindexed, writeIndexedTestFile } from '../helpers/test-file-manager';
import { ev, PRELUDE, openView, closeViews, overrideSettings, ymd, type HeldSettings } from '../helpers/view-helper';

const FILE = 'test-int-card-checkbox.md';
const TITLE = '箱の色の親';
const RED = 'rgb(255, 0, 0)';

const note = () => ['---', 'tv-color: "#ff0000"', '---', '', `- [ ] ${TITLE} @${ymd(new Date())}`, ''].join('\n');

interface BoxReading {
    checked: boolean;
    item: string | null;
    color: string;
}

interface Click {
    /** The box as the click left it, read before anything is drawn. */
    clicked: BoxReading;
    /** Whether the card's box is still the element clicked when `clicked` was read. */
    sameBox: boolean;
    /** The box once the card has been drawn from the file again. */
    drawn: BoxReading;
}

/** Click the card's own box in the view `name`, and read it at once and after the card is drawn again. */
function clickBox(name: string): Click {
    return ev<Click>(`(async () => {
        ${PRELUDE}
        const root = V(${JSON.stringify(name)}).contentEl;
        const find = () => {
            const card = [...root.querySelectorAll('.task-card')].find(c => c.textContent.includes(${JSON.stringify(TITLE)}));
            return card?.querySelector('.task-card__content > ul > li > input.task-list-item-checkbox') ?? null;
        };
        const readBox = (b) => ({
            checked: b.checked,
            item: b.closest('li').getAttribute('data-task'),
            color: getComputedStyle(b).backgroundColor,
        });
        const box = find();
        if (!box) throw new Error('no box on the card');
        box.click();
        const clicked = readBox(box);
        const sameBox = find() === box;
        const start = Date.now();
        while (find() === box && Date.now() - start < 3000) await wait(20);
        const now = find();
        if (!now || now === box) throw new Error('the card was not drawn again');
        return JSON.stringify({ clicked, sameBox, drawn: readBox(now) });
    })()`);
}

describe('a card\'s own checkbox', () => {
    let held: HeldSettings<'applyGlobalStyles'>;

    beforeAll(async () => {
        if (!isObsidianRunning()) {
            throw new Error('Obsidian is not running or CLI is unreachable. Start Obsidian with the Dev vault before running integration tests.');
        }
        held = overrideSettings({ applyGlobalStyles: true });
        expect(await writeIndexedTestFile(FILE, note())).toBe(true);
    });

    afterAll(async () => {
        await closeViews();
        held?.restore();
        deleteTestFile(FILE);
        await waitForFileDeindexed(FILE);
    });

    for (const [type, name] of [['timeline-view', 'checkbox-timeline'], ['calendar-view', 'checkbox-calendar']] as const) {
        it(`${type}: shows the status it writes, in the task's color, before the card is drawn again`, async () => {
            expect(await writeIndexedTestFile(FILE, note())).toBe(true);
            openView(name, type);

            const tick = clickBox(name);
            expect(tick.sameBox).toBe(true);
            expect(tick.clicked).toEqual({ checked: true, item: 'x', color: RED });
            expect(tick.drawn).toEqual({ checked: true, item: 'x', color: RED });
            expect(readTestFile(FILE)).toContain(`- [x] ${TITLE}`);

            const untick = clickBox(name);
            expect(untick.sameBox).toBe(true);
            expect(untick.clicked.checked).toBe(false);
            expect(untick.clicked.item ?? '').toBe('');
            expect(untick.drawn.checked).toBe(false);
            expect(readTestFile(FILE)).toContain(`- [ ] ${TITLE}`);
        });
    }
});
