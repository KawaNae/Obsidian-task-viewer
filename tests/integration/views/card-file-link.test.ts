/**
 * The link to a card's note, in the running Dev vault. Obsidian draws the
 * task's line alone, and the card puts the link at the end of it as an
 * `a.internal-link`. Drawn as one line of markdown, a name and a note's path
 * with an `_` each were read as one emphasis, which made the name italic and
 * took the link apart (`イラスト練習<em>2026-11-05 : [[…イラスト</em>…`).
 *
 * The note's name has an `_`, and every task's name too. Each way a card is
 * drawn is read: a timed card (the full draw), an all-day card (compact), a
 * card with a child under its line, one whose children are collapsed, the
 * hub's preview, a task with no name, and a masked card.
 *
 * Prerequisites:
 *   - Obsidian is running with the Dev vault (path in dev-paths.mjs) open,
 *     with the current build loaded (`npm run build`, then reload the plugin)
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/views/card-file-link.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { isObsidianRunning } from '../helpers/cli-helper';
import { deleteTestFile, waitForFileDeindexed, writeIndexedTestFile } from '../helpers/test-file-manager';
import { PRELUDE, SETTLE_MS, closeViews, ev, openView, overrideSettings, type HeldSettings } from '../helpers/view-helper';

const FILE = 'SyncIgnore/test-int-イラスト_絵の練習.md';
const TARGET = FILE.replace(/\.md$/, '');
const BASENAME = 'test-int-イラスト_絵の練習';
const DAY = '2027-05-12';

const NOTE = [
    `- [ ] イラスト練習_2026-11-05 @${DAY}T09:00>10:00`,
    `- [ ] 終日の練習_2026-11-05 @${DAY}`,
    `- [ ] 子のある練習_2026-11-05 @${DAY}T11:00>12:00`,
    '    - [ ] 子_a',
    `- [ ] 畳む練習_2026-11-05 @${DAY}T13:00>14:00`,
    '    - [ ] 子_a',
    '    - [ ] 子_b',
    '    - [ ] 子_c',
    `- [ ] _斜体_ の練習 @${DAY}T15:00>16:00`,
    `- [ ] @${DAY}T17:00>18:00`,
    `- [ ] 伏せる練習_2026-11-05 @${DAY}T19:00>20:00`,
    '    - tv-mask:: 伏せ字: 中身',
    '',
].join('\n');

/** The parent's line of a card, as drawn. */
interface Line {
    /** The text of the line before the note's link. */
    name: string;
    /** The texts of the emphases on the line. */
    ems: string[];
    /** Whether the line has its checkbox. */
    box: boolean;
    /** The note's link: its separator, its target and its text. */
    link: { sep: string; href: string | null; text: string } | null;
    /** Whether nothing of the line comes after the link (a nested list may). */
    linkLast: boolean;
    /** Whether a list is nested in the item, after the link. */
    nested: boolean;
}

/** What reads a card's parent line, in the vault (`line(card)`). */
const READ_LINE = `
    const lineOf = (li) => [...li.childNodes].filter(n => !(n.nodeType === 1 && n.matches('ul, ol')));
    const line = (content) => {
        const li = content?.querySelector(':scope > ul > li');
        if (!li) return null;
        const host = li.querySelector(':scope > p') ?? li;
        const span = host.querySelector(':scope > .task-card__file-link');
        const a = span?.querySelector('a.internal-link');
        const nodes = lineOf(host);
        const before = span ? nodes.slice(0, nodes.indexOf(span)) : nodes;
        const after = span ? nodes.slice(nodes.indexOf(span) + 1) : [];
        const ems = nodes.flatMap(n => n.nodeType === 1 ? [...(n.matches('em') ? [n] : []), ...n.querySelectorAll('em')] : []);
        return {
            name: before.map(n => n.textContent).join('').trim(),
            ems: ems.map(e => e.textContent),
            box: !!host.querySelector(':scope > input.task-list-item-checkbox'),
            link: span ? { sep: span.firstChild?.nodeType === 3 ? span.firstChild.textContent : '', href: a?.getAttribute('data-href') ?? null, text: a?.textContent ?? '' } : null,
            linkLast: !!span && after.every(n => n.nodeType === 3 && !n.textContent.trim()),
            nested: !!li.querySelector(':scope > ul, :scope > ol'),
        };
    };
`;

/** The parent lines of the test's cards in `view`, by the name each starts with (the nameless one under ''). */
function lines(view: string): Record<string, Line> {
    return ev(`(async () => {
        ${PRELUDE}
        ${READ_LINE}
        await wait(${SETTLE_MS});
        const out = {};
        for (const card of V(${JSON.stringify(view)}).contentEl.querySelectorAll('.task-card')) {
            const l = line(card.querySelector(':scope > .task-card__content'));
            if (!l || l.link?.href !== ${JSON.stringify(TARGET)}) continue;
            out[l.name.split('_')[0]] = l;
        }
        return JSON.stringify(out);
    })()`);
}

let held: HeldSettings<'childCollapseThreshold' | 'enableCardFileLink'>;

beforeAll(async () => {
    if (!isObsidianRunning()) {
        throw new Error('Obsidian is not running or CLI is unreachable. Start Obsidian with the Dev vault before running integration tests.');
    }
    held = overrideSettings({ childCollapseThreshold: 3, enableCardFileLink: true });
    expect(await writeIndexedTestFile(FILE, NOTE)).toBe(true);
});

afterAll(async () => {
    await closeViews();
    held?.restore();
    deleteTestFile(FILE);
    await waitForFileDeindexed(FILE);
});

const LINK = { sep: ' : ', href: TARGET, text: BASENAME };

describe('the link to a card\'s note', () => {
    it('is an internal link at the end of the line, and the name is not read with it', () => {
        openView('fl-tl', 'timeline-view', { date: DAY, daysToShow: 3, showSidebar: false });
        const l = lines('fl-tl');

        for (const name of ['イラスト練習', '終日の練習', '子のある練習', '畳む練習', '伏せる練習']) {
            expect(l[name], name).toMatchObject({ name: `${name}_2026-11-05`, ems: [], box: true, link: LINK, linkLast: true });
        }
        // Under the line, before the child drawn in the item.
        expect(l['子のある練習'].nested).toBe(true);
        expect(l['畳む練習'].nested).toBe(false);
    });

    it('leaves an emphasis the user wrote', () => {
        const l = lines('fl-tl');
        const italic = Object.values(l).find(line => line.name.endsWith('の練習') && line.ems.length > 0);
        expect(italic).toMatchObject({ name: '斜体 の練習', ems: ['斜体'], link: LINK, linkLast: true });
    });

    it('stands alone after the box of a task with no name', () => {
        const l = lines('fl-tl');
        expect(l['']).toMatchObject({ name: '', ems: [], box: true, link: { sep: '', href: TARGET, text: BASENAME }, linkLast: true });
    });

    it('opens and previews the note as the other links of a card do', () => {
        const got = ev<{ hover: string | null; open: string | null }>(`(async () => {
            ${PRELUDE}
            const card = [...V('fl-tl').contentEl.querySelectorAll('.task-card')].find(c => c.querySelector('.task-card__content')?.textContent.trim().startsWith('イラスト練習'));
            const a = card.querySelector('.task-card__file-link a.internal-link');
            const ws = app.workspace;
            const trigger = ws.trigger;
            const openLinkText = ws.openLinkText;
            let hover = null;
            let open = null;
            // Heard, not passed on: no preview pops up and no note opens.
            ws.trigger = function (name, ...args) { if (name === 'hover-link') { hover = args[0].linktext; return; } return trigger.call(this, name, ...args); };
            ws.openLinkText = async (linktext) => { open = linktext; };
            try {
                a.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
                a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
            } finally {
                ws.trigger = trigger;
                ws.openLinkText = openLinkText;
            }
            return JSON.stringify({ hover, open });
        })()`);
        expect(got).toEqual({ hover: TARGET, open: TARGET });
    });

    it('is in the hub\'s preview', () => {
        const l = ev<Line | null>(`(async () => {
            ${PRELUDE}
            ${READ_LINE}
            const task = P.getIndex().getTasks().find(t => t.file === ${JSON.stringify(FILE)} && t.content.startsWith('子のある練習'));
            P.openTaskHub(task.id);
            await wait(300);
            const got = line(document.querySelector('.task-hub .task-hub__preview .task-card__content'));
            document.querySelector('.task-hub .tv-overlay__close')?.click();
            await wait(300);
            return JSON.stringify(got);
        })()`);
        expect(l).toMatchObject({ name: '子のある練習_2026-11-05', ems: [], box: true, link: LINK, linkLast: true, nested: true });
    });

    it('is hidden with its separator under the mask, which shows whole', () => {
        openView('fl-mask', 'timeline-view', { date: DAY, daysToShow: 3, showSidebar: false, maskMode: true });
        const got = ev<{ shown: string; hidden: boolean }>(`(async () => {
            ${PRELUDE}
            await wait(${SETTLE_MS});
            const card = [...V('fl-mask').contentEl.querySelectorAll('.task-card')].find(c => c.querySelector('.task-card__content')?.textContent.includes('伏せ字'));
            const li = card.querySelector(':scope > .task-card__content > ul > li');
            const span = li.querySelector('.task-card__file-link');
            return JSON.stringify({ shown: li.innerText.trim(), hidden: getComputedStyle(span).display === 'none' });
        })()`);
        expect(got).toEqual({ shown: '伏せ字: 中身', hidden: true });
    });
});
