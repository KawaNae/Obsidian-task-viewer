/**
 * What a card shows of a style a layer says it has none of, in the running
 * Dev vault: a property with no value (`- tv-color::`, the frontmatter's
 * `tv-linestyle:`) hides the value above it, and a value the plugin cannot
 * read (`- tv-linestyle:: wavy`) is read as not written, letting the value
 * above it through. A value written above the first heading wins over the
 * frontmatter's and reaches every task; a custom key of the frontmatter
 * reaches none.
 *
 * The tasks are in April 2027, in a note of the test's own; a Timeline is
 * opened on that day. A card is found by the name its text starts with; its
 * color is its `--file-accent`, its line style its `data-file-linestyle`.
 * The mask is read with the view's mask mode on, as the text the card shows.
 *
 * Prerequisites:
 *   - Obsidian is running with the Dev vault open, with the current build
 *     loaded (`npm run build`, then reload the plugin)
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/views/cascade-null.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { cliList, isObsidianRunning } from '../helpers/cli-helper';
import { deleteTestFile, waitForFileDeindexed, writeIndexedTestFile } from '../helpers/test-file-manager';
import { PRELUDE, SETTLE_MS, closeViews, ev, openView } from '../helpers/view-helper';

const FILE = 'test-int-cascade-null.md';
const DAY = '2027-04-21';

const NOTE = [
    '---',
    'tv-color: "#ff0000"',
    'tv-linestyle: dashed',
    'tv-mask: fm-mask',
    'note-only: x',
    '---',
    '- area:: lab',
    '- tv-mask:: root-mask',
    `- [ ] cn-inherit @${DAY}`,
    `- [ ] cn-own-none @${DAY}`,
    '    - tv-color::',
    '    - tv-mask::',
    '    - area::',
    `- [ ] cn-unreadable @${DAY}`,
    '    - tv-linestyle:: wavy',
    '    - tv-color::',
    '        - blue',
    '## Hidden',
    '- tv-linestyle::',
    '- tv-mask:: ~',
    `- [ ] cn-section-none @${DAY}`,
    '## Again',
    '- tv-linestyle::',
    `- [ ] cn-overridden @${DAY}`,
    '    - tv-linestyle:: dotted',
    '',
].join('\n');

interface CardStyle { color: string | null; linestyle: string | null }

/** The color and line style of each card of the test in `view`, by name. */
function styles(view: string): Record<string, CardStyle> {
    return ev(`(async () => {
        ${PRELUDE}
        await wait(${SETTLE_MS});
        const el = V(${JSON.stringify(view)}).contentEl;
        const out = {};
        for (const card of el.querySelectorAll('.task-card')) {
            const name = (card.querySelector('.task-card__content')?.textContent ?? '').match(/cn-[a-z-]+/)?.[0];
            if (!name) continue;
            out[name] = {
                color: card.style.getPropertyValue('--file-accent') || null,
                linestyle: card.dataset.fileLinestyle ?? null,
            };
        }
        return JSON.stringify(out);
    })()`);
}

/** The texts the cards in `view` show, sorted. */
function texts(view: string): string[] {
    return ev<string[]>(`(async () => {
        ${PRELUDE}
        await wait(${SETTLE_MS});
        const el = V(${JSON.stringify(view)}).contentEl;
        return JSON.stringify([...el.querySelectorAll('.task-card .task-card__content')].map(c => c.textContent.trim()).sort());
    })()`);
}

beforeAll(async () => {
    if (!isObsidianRunning()) {
        throw new Error('Obsidian is not running or CLI is unreachable. Start Obsidian with the Dev vault before running integration tests.');
    }
    expect(await writeIndexedTestFile(FILE, NOTE)).toBe(true);
});

afterAll(async () => {
    await closeViews();
    deleteTestFile(FILE);
    await waitForFileDeindexed(FILE);
});

describe('a card shows a style hidden with no value, and the one above an unreadable value', () => {
    it('colors and line styles', () => {
        openView('cn-tl', 'timeline-view', { date: DAY, daysToShow: 3, showSidebar: false });
        const s = styles('cn-tl');
        expect(s['cn-inherit']).toMatchObject({ linestyle: 'dashed' });
        expect(s['cn-inherit'].color).not.toBeNull();
        expect(s['cn-own-none']).toEqual({ color: null, linestyle: 'dashed' });
        expect(s['cn-unreadable']).toEqual({ color: s['cn-inherit'].color, linestyle: 'dashed' });
        expect(s['cn-section-none']).toEqual({ color: s['cn-inherit'].color, linestyle: null });
        expect(s['cn-overridden']).toEqual({ color: s['cn-inherit'].color, linestyle: 'dotted' });
    });

    it('masks', () => {
        openView('cn-mask', 'timeline-view', { date: DAY, daysToShow: 3, showSidebar: false, maskMode: true });
        // A card's text ends in its note's link, which the mask leaves.
        const shown = texts('cn-mask').map(text => text.match(/^(fm-mask|root-mask|cn-[a-z-]+)/)?.[1]);
        // The mask above the first heading, over the frontmatter's, on every card but those that hide it.
        expect(shown).toEqual(['cn-own-none', 'cn-section-none', 'root-mask', 'root-mask', 'root-mask']);
    });

    it('the API gives a custom property hidden with no value as null, and none of the frontmatter\'s custom keys', () => {
        const r = cliList({ file: FILE, 'output-fields': 'content,color,linestyle,properties' });
        const by = Object.fromEntries(r.tasks.map(t => [t.content, t]));
        expect(by['cn-own-none'].properties).toEqual({ area: null });
        expect(by['cn-inherit'].properties).toEqual({ area: 'lab' });
        expect(by['cn-overridden'].properties).toEqual({ area: 'lab' });
        expect(by['cn-own-none'].color).toBeNull();
        expect(by['cn-section-none'].linestyle).toBeNull();
    });
});
