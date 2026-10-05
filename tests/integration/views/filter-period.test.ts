/**
 * The filter's period condition and its ranges (段11d), in the running Dev
 * vault: a pinned list's filter menu driven as the user clicks it (the
 * property, the operator, the value's kind, the range's two fields), what
 * the list keeps (`filterState`) and how many tasks it counts; and a filter
 * file read by the CLI's `list` with a date and a time in it.
 *
 * The days are a week W far from today (the week of today + 21 days), so
 * no boundary leans on the clock. The tasks are in notes of the test's own,
 * removed at the end.
 *
 * Prerequisites:
 *   - Obsidian is running with the Dev vault open, with the current build
 *     loaded (`npm run build`, then reload the plugin)
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/views/filter-period.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { cliList, isObsidianRunning } from '../helpers/cli-helper';
import { deleteTestFile, waitForFileDeindexed, writeIndexedTestFile, writeTestFile } from '../helpers/test-file-manager';
import {
    PRELUDE, SETTLE_MS, addDays, closeViews, ev, openView, readSettings, tr, visualDay, weekStart,
} from '../helpers/view-helper';

const FILE = 'test-int-filter-period.md';
const FILTER_FILE = 'test-int-filter-period.json';
const TAG = 'tvfp';
const CLI_TAG = 'tvfpcli';

/** W's Monday (its first day), and the day n days from it. */
let W: string;
const w = (n: number) => addDays(W, n);

function note(): string {
    return [
        `- [ ] fp-inside #${TAG} @${w(2)}`,
        `- [ ] fp-across #${TAG} @${w(-2)}>${w(1)}`,
        `- [ ] fp-due #${TAG} @>>${w(3)}`,
        `- [ ] fp-outside #${TAG} @${w(10)}`,
        `- [ ] fp-outside-due #${TAG} @${w(10)}>>${w(4)}`,
        `- [ ] fp-nodate #${TAG}`,
        `- [ ] fp-cli-09 #${CLI_TAG} @${w(2)}T09:00`,
        `- [ ] fp-cli-11 #${CLI_TAG} @${w(2)}T11:00`,
        '',
    ].join('\n');
}

const C = {
    root: 'pinned-list',
    header: 'pinned-list__header',
    name: 'pinned-list__name',
    nameInput: 'pinned-list__name-input',
    count: 'pinned-list__count',
    body: 'pinned-list__body',
    collapsed: 'pinned-list--collapsed',
};

interface Reading {
    filterState: { logic: string; filters: Record<string, unknown>[] };
    count: number;
    names: string[];
    /** The open filter menu: the texts of the date fields of each row, the lines said under them. */
    fields: string[][];
    says: string[];
}

/** Run `body` in the view `name` (with the filter menu's helpers), and read its first list once drawn. */
function op(name: string, body: string, settleMs = SETTLE_MS): Reading {
    return ev<Reading>(`(async () => {
        ${PRELUDE}
        const C = ${JSON.stringify(C)};
        const el = V(${JSON.stringify(name)}).contentEl;
        const sec = () => el.querySelector('.' + C.root);
        const open = () => document.querySelector('.tv-overlay__panel.filter-popover');
        const row = (i) => fRows()[i];
        const headerButton = (i, text) => buttonText(row(i).querySelector('.filter-popover__row-header'), text);
        const pick = async (button, label) => { button.click(); await wait(100); pickChild(label); await wait(100); };
        const dateInputs = (i) => [...row(i).querySelectorAll('.filter-popover__date-field input.tv-ctrl__text-input')];
        const type = async (input, text) => {
            input.focus();
            input.value = text;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            key(input, 'Enter');
            await wait(50);
        };
        ${body}
        await wait(${settleMs});
        const list = V(${JSON.stringify(name)}).getState().pinnedLists[0];
        const body = sec().querySelector('.' + C.body);
        return JSON.stringify({
            filterState: list.filterState,
            count: Number((sec().querySelector('.' + C.count)?.textContent ?? '').replace(/[()]/g, '')),
            names: body ? [...body.querySelectorAll(':scope > .task-card')].map(c => c.textContent.match(/fp-[a-z0-9-]+/)?.[0] ?? '').sort() : [],
            fields: open() ? fRows().map(r => [...r.querySelectorAll('.filter-popover__date-field input.tv-ctrl__text-input')].map(i => i.value)) : [],
            says: open() ? [...open().querySelectorAll('.filter-popover__says > div')].map(d => d.textContent) : [],
        });
    })()`);
}

const TAGGED = { property: 'tag', operator: 'includes', value: [TAG] };

beforeAll(async () => {
    if (!isObsidianRunning()) {
        throw new Error('Obsidian is not running or CLI is unreachable. Start Obsidian with the Dev vault before running integration tests.');
    }
    const { startHour, weekStartDay } = readSettings(['startHour', 'weekStartDay']) as { startHour: number; weekStartDay: number };
    W = weekStart(addDays(visualDay(startHour), 21), weekStartDay);
    expect(await writeIndexedTestFile(FILE, note())).toBe(true);
});

afterAll(async () => {
    ev(`(() => { document.querySelectorAll('.tv-overlay__panel .tv-overlay__close').forEach(b => b.click()); return JSON.stringify(true); })()`);
    await closeViews();
    deleteTestFile(FILE);
    deleteTestFile(FILTER_FILE);
    await waitForFileDeindexed(FILE);
});

describe("a pinned list's period and range conditions", () => {
    const name = 'fp-tl';

    beforeAll(() => {
        openView(name, 'timeline-view', {
            showSidebar: true,
            pinnedLists: [{ id: 'fp', name: 'Period', filterState: { logic: 'and', filters: [TAGGED] } }],
        });
    });

    it('keeps the tasks whose span overlaps the range put in its two fields', () => {
        const r = op(name, `
            headerBtn(C, sec(), 'filter').click();
            await wait(200);
            buttonText(fFooter(), ${JSON.stringify(tr('filter.addFilter'))}).click();
            await wait(100);
            await pick(headerButton(1, ${JSON.stringify(tr('filter.property.tag'))}), ${JSON.stringify(tr('filter.property.period'))});
            await pick(row(1).querySelector('.filter-popover__date-kind-btn'), ${JSON.stringify(tr('filter.dateKind.range'))});
            // The range starts as today to today: the last day first, so that no step is reversed.
            await type(dateInputs(1)[1], ${JSON.stringify(w(6))});
            await type(dateInputs(1)[0], ${JSON.stringify(w(0))});
        `);
        expect(r.filterState.filters[1]).toEqual({ property: 'period', operator: 'overlaps', value: { from: w(0), to: w(6) } });
        expect(r.names).toEqual(['fp-across', 'fp-due', 'fp-inside']);
        expect(r.count).toBe(3);
    });

    it('turned to does not overlap, keeps the tasks outside, and none with no date', () => {
        const r = op(name, `
            await pick(headerButton(1, ${JSON.stringify(tr('filter.operators.period.overlaps'))}), ${JSON.stringify(tr('filter.operators.period.notOverlaps'))});
        `);
        expect(r.filterState.filters[1]).toEqual({ property: 'period', operator: 'notOverlaps', value: { from: w(0), to: w(6) } });
        expect(r.names).toEqual(['fp-outside', 'fp-outside-due']);
    });

    it('shows the same days in the two fields when the menu is opened again', () => {
        const r = op(name, `
            closeOverlays();
            await wait(200);
            headerBtn(C, sec(), 'filter').click();
            await wait(200);
        `);
        expect(r.fields[1]).toEqual([w(0), w(6)]);
    });

    it('says why under the field, and keeps the filter, for a day that does not exist and a first day after the last', () => {
        let r = op(name, `await type(dateInputs(1)[0], '2026-02-30');`);
        expect(r.says.length).toBe(1);
        expect(r.filterState.filters[1]).toMatchObject({ value: { from: w(0), to: w(6) } });

        r = op(name, `
            closeOverlays();
            await wait(200);
            headerBtn(C, sec(), 'filter').click();
            await wait(200);
            await type(dateInputs(1)[0], ${JSON.stringify(w(8))});
        `);
        expect(r.says).toEqual([tr('filter.rangeReversed')]);
        expect(r.filterState.filters[1]).toMatchObject({ value: { from: w(0), to: w(6) } });
    });

    it('a due equal to a range keeps the dues in it; turned to on or before, the value is the range\'s last day', () => {
        let r = op(name, `
            closeOverlays();
            await wait(200);
            headerBtn(C, sec(), 'filter').click();
            await wait(200);
            await pick(headerButton(1, ${JSON.stringify(tr('filter.property.period'))}), ${JSON.stringify(tr('filter.property.due'))});
            await pick(headerButton(1, ${JSON.stringify(tr('filter.operators.due.isSet'))}), ${JSON.stringify(tr('filter.operators.due.equals'))});
            await pick(row(1).querySelector('.filter-popover__date-kind-btn'), ${JSON.stringify(tr('filter.dateKind.range'))});
            await type(dateInputs(1)[1], ${JSON.stringify(w(6))});
            await type(dateInputs(1)[0], ${JSON.stringify(w(0))});
        `);
        expect(r.filterState.filters[1]).toEqual({ property: 'due', operator: 'equals', value: { from: w(0), to: w(6) } });
        expect(r.names).toEqual(['fp-due', 'fp-outside-due']);

        r = op(name, `
            await pick(headerButton(1, ${JSON.stringify(tr('filter.operators.due.equals'))}), ${JSON.stringify(tr('filter.operators.due.onOrBefore'))});
        `);
        expect(r.filterState.filters[1]).toEqual({ property: 'due', operator: 'onOrBefore', value: w(6) });
        expect(r.fields[1]).toEqual([w(6)]);
        expect(r.names).toEqual(['fp-due', 'fp-outside-due']);
    });
});

describe("the CLI's list with a filter file", () => {
    it('compares a date and a time as a moment: a start before 10:00 takes 09:00, not 11:00', () => {
        writeTestFile(FILTER_FILE, JSON.stringify({
            logic: 'and',
            filters: [
                { property: 'tag', operator: 'includes', value: [CLI_TAG] },
                { property: 'startDate', operator: 'before', value: `${w(2)} 10:00` },
            ],
        }));
        const r = cliList({ 'filter-file': FILTER_FILE, 'output-fields': 'content' });
        expect(r.tasks.map(t => String(t.content).split(' ')[0])).toEqual(['fp-cli-09']);
    });
});
