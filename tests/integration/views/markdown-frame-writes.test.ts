/**
 * What a click of a checkbox of a markdown frame's card writes to its note,
 * in the running E2E vault, read off the note's file: the line the checkbox
 * stands for, its status character turned, and no other line; nothing,
 * with a notice, when which line it stands for cannot be confirmed, or when
 * the note is no longer what the card was read from.
 *
 * - Markdowns of many shapes, each a card of its own, every checkbox
 *   pressed in turn: lists, quotes, callouts, comments, math, tables; and
 *   shapes the plugin does not read as it reads tasks (HTML, footnotes, a
 *   tab after a quote's `>`, a fence a comment hides)
 * - Task lines of many shapes in one card: marks, links, fields, embeds,
 *   footnotes, continuations; and one opening with a tag, drawn as a tag
 * - Cards whose lines are not the note's lines in order: a property line
 *   skipped, a card under the section's first, blank lines cut off
 * - A checkbox written as HTML, above a line whose status names a line as
 *   the card's own renders do, which writes nothing
 * - A card with a `dataviewjs` block, whose script a click runs as often as
 *   a write of the note apart from the click does
 * - A note written apart from the plugin before its frame reads it again; a
 *   line put above the card, read again but not rendered again; two
 *   checkboxes of a card clicked before it is read again
 * - A line that repeats (`==>`): its next line made, as a task card's
 *   checkbox makes it, but in a quote, a callout or a note the plugin
 *   ignores (`tv-ignore`), where it turns the status alone
 *
 * The repeating lines repeat by a date of their own (`at(start + 1d)`),
 * whatever day it is.
 *
 * Prerequisites:
 *   - Obsidian is running with the E2E vault open, with the current build
 *     loaded (the preflight builds it into the vault)
 *   - Dataview enabled in the vault, with DataviewJS
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/views/markdown-frame-writes.test.ts
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { createTeardown } from '../helpers/teardown';
import { deleteNotesUnder } from '../helpers/markdown-frames';
import { boxCount as countOf, cardsIn as cardsOfView, judged, pressEach as pressOf, turned, worded, writeNotes as write } from '../helpers/markdown-frame-presses';
import { requireDataview } from '../helpers/prerequisites';
import { SETTLE_MS, closeViews, ev, openView, tr } from '../helpers/view-helper';

const PREFIX = 'test-int-mdwrites';
const F = '```';

const cardsIn = (name: string) => cardsOfView(PREFIX, name);
const pressEach = (name: string, id: string, which: number | string, path: string, boxes: number[]) => pressOf(PREFIX, name, id, which, path, boxes);
const boxCount = (name: string, id: string, which: number | string) => countOf(PREFIX, name, id, which);
const writeNotes = (notes: Record<string, string>) => write(PREFIX, notes);

interface Press {
    /** The note's file once the click was answered. */
    note: string;
    /** The texts of the notices the click brought. */
    notices: string[];
}

const teardown = createTeardown();

beforeAll(() => {
    deleteNotesUnder(PREFIX);
    teardown.add('delete the notes', () => deleteNotesUnder(PREFIX));
    teardown.add('close the views', closeViews);
});

afterAll(() => teardown.run());

/**
 * Markdowns, each under a heading of its own, with the lines of the
 * markdown that hold a checkbox drawn, in their order.
 */
const SHAPES: [name: string, markdown: string, boxLines: number[]][] = [
    ['top', '- [ ] a\n- [x] b', [0, 1]],
    ['after-heading-para', '## H\n\npara\n\n- [ ] a\n- [ ] b', [4, 5]],
    ['two-lists', '- [ ] a\n\npara\n\n- [ ] b\n- [ ] c', [0, 4, 5]],
    ['loose-list', '- [ ] a\n\n- [ ] b', [0, 2]],
    ['nest-4sp', '- [ ] a\n    - [ ] b\n        - [ ] c', [0, 1, 2]],
    ['nest-2sp', '- [ ] a\n  - [ ] b\n    - [ ] c', [0, 1, 2]],
    ['nest-tab', '- [ ] a\n\t- [ ] b\n\t\t- [ ] c', [0, 1, 2]],
    ['ordered', '1. [ ] a\n2. [x] b', [0, 1]],
    ['ordered-kinds', '1. [ ] a\n2) [x] b\n10. [-] c', [0, 1, 2]],
    ['star-plus', '* [ ] a\n+ [ ] b', [0, 1]],
    ['quote', '> - [ ] a\n> - [ ] b', [0, 1]],
    ['quote-nested', '> > - [ ] a\n> - [ ] b\n> > > - [x] c', [0, 1, 2]],
    ['quote-lazy', '> - [ ] a\nlazy\n> - [ ] b', [0, 2]],
    ['quote-rules', '> ---\n> - [ ] a\n> ---\n> - [ ] b', [1, 3]],
    ['para-then-quote', 'para\n\n> - [ ] a', [2]],
    ['callout', '> [!note]\n> - [ ] a\n> - [ ] b', [1, 2]],
    ['callout-list', '> [!todo]\n> - [ ] a\n>   - [x] b\n> 1. [/] c', [1, 2, 3]],
    ['list-quote', '- [ ] a\n    > - [ ] b\n- [ ] c', [0, 1, 2]],
    ['code-before', `${F}\n- [ ] x\n${F}\n\n- [ ] a`, [4]],
    ['continuation-para', '- [ ] a\n\n    para\n- [ ] b', [0, 3]],
    ['continuation-lazy', '- [ ] a\n  cont\n- [ ] b', [0, 2]],
    ['status-chars', '- [x] a\n- [ ] b\n- [/] c\n- [-] d\n- [>] e\n- [?] f\n- [X] g', [0, 1, 2, 3, 4, 5, 6]],
    ['comment-block', '%%\n- [ ] hidden\n%%\n- [ ] a', [3]],
    ['comment-inline', '- [ ] a %% c %%\n%% - [ ] x %%\n- [ ] b', [0, 2]],
    ['comment-mid-line', 'para %%\n- [ ] hidden\n%%\n- [ ] a', [1]],
    ['comment-after-item', '- [ ] a\n%%\n- [ ] b\n%%\n- [ ] c', [0, 4]],
    ['comment-in-quote', '> %%\n> - [ ] x\n> %%\n> - [ ] a', [3]],
    ['table-then-list', '| a | b |\n| - | - |\n| 1 | 2 |\n- [ ] a', [3]],
    ['heading-card', '## Card\n- [ ] a\n\ntext\n### deeper\n- [ ] b', [1, 5]],
    ['para-no-blank', 'para\n- [ ] a', [1]],
    ['math-before', '$$\nx^2 + y^2\n$$\ntext $x$\n- [ ] a\n- [ ] b', [4, 5]],
];

describe('a checkbox of a card of a markdown of many shapes', () => {
    const name = 'mdwrites-shapes';
    const NOTE = `${PREFIX}-shapes`;
    const PATH = `${NOTE}.md`;
    const TEXT = [...SHAPES.flatMap(([shape, markdown]) => [`# ${shape}`, markdown, ''])].join('\n');
    /** The note's line of each shape's first line: its heading's, one down. */
    const start = new Map<string, number>();
    let at = 0;
    for (const [shape, markdown] of SHAPES) {
        start.set(shape, at + 1);
        at += markdown.split('\n').length + 2;
    }

    beforeAll(() => {
        writeNotes({ [PATH]: TEXT });
        openView(name, 'timeline-view', { showSidebar: true, sidebar: [{ kind: 'markdown', id: 'shapes', link: NOTE }] });
    });

    // The view's thirty cards are not kept rendered for the tests after it.
    afterAll(closeViews);

    it.each(SHAPES)('writes the line of each checkbox pressed, and no other line: %s', (shape, _markdown, boxLines) => {
        writeNotes({ [PATH]: TEXT });
        expect(boxCount(name, 'shapes', shape)).toBe(boxLines.length);
        const presses = pressEach(name, 'shapes', shape, PATH, boxLines.map((_l, i) => i));
        let expected = TEXT;
        presses.forEach((press, i) => {
            const line = start.get(shape)! + boxLines[i];
            expected = turned(expected, line);
            expect(press).toMatchObject({ note: expected, notices: [], checked: press.shown !== '' });
            expect(expected.split('\n')[line]).toContain(press.item);
        });
    });

    it.each([
        ['[ ] to [x]', 'top', 0, '- [x] a'],
        ['[x] to [ ]', 'top', 1, '- [ ] b'],
        ['[/] to [ ]', 'status-chars', 2, '- [ ] c'],
        ['[-] to [ ]', 'status-chars', 3, '- [ ] d'],
        ['[X] to [ ]', 'status-chars', 6, '- [ ] g'],
    ])('turns %s', (_turn, shape, box, line) => {
        writeNotes({ [PATH]: TEXT });
        const [press] = pressEach(name, 'shapes', shape, PATH, [box]);
        expect(press.note.split('\n')[start.get(shape)! + SHAPES.find(s => s[0] === shape)![2][box]]).toBe(line);
    });
});

/**
 * Markdowns the plugin does not read as it reads task lines, each a card of
 * its own, each `@` a word of its own: a checkbox writes the line of the
 * word drawn on its item.
 */
const UNREAD: [name: string, markdown: string][] = [
    ['html-block', '<div>\n- [ ] @\n</div>\n\n- [ ] @'],
    ['html-then-item', '<div>x</div>\n\n- [ ] @'],
    ['math-then-item', '$$\nx\n$$\n- [ ] @'],
    ['footnote', 'text[^1]\n\n[^1]: - [ ] @\n    - [ ] @'],
    ['footnote-then-item', '[^2]: a note\n\n- [ ] @'],
    ['quote-tab', '>\t- [ ] @\n>\t\t- [ ] @\n\n- [ ] @'],
    ['comment-holding-fence', `%%\n${F}\n%%\n- [ ] @\n${F}`],
    ['html-and-comment-holding-fence', `<div>\n- [ ] @\n</div>\n\n- [ ] @\n%%\n${F}\n%%\n- [ ] @\n${F}`],
    ['comment-indented', '- [ ] @\n- [x] @\n  %%\n- [ ] @\n%%\n- [ ] @'],
    ['math-in-quote', '> $$\n> - [ ] @\n> $$\n> - [ ] @'],
    ['ordered-after-table', '| a | b |\n| - | - |\n| - [ ] @ | y |\n2. [ ] @\n- [ ] @'],
    ['ten-digits', '1234567890. [ ] @\n- [ ] @'],
    ['bracket-status', '- []] @\n- [ ] @'],
];

describe('a checkbox of a card of a markdown the plugin does not read as task lines', () => {
    const name = 'mdwrites-unread';
    const NOTE = `${PREFIX}-unread`;
    const PATH = `${NOTE}.md`;
    let n = 0;
    const TEXT = UNREAD.flatMap(([shape, markdown]) => {
        const [text, next] = worded(markdown, n);
        n = next;
        return [`# ${shape}`, text, ''];
    }).join('\n');

    beforeAll(() => {
        writeNotes({ [PATH]: TEXT });
        openView(name, 'timeline-view', { showSidebar: true, sidebar: [{ kind: 'markdown', id: 'unread', link: NOTE }] });
    });

    afterAll(closeViews);

    it.each(UNREAD.map(([shape]) => shape))('writes the line of the word drawn on each checkbox pressed, and no other line: %s', (shape) => {
        writeNotes({ [PATH]: TEXT });
        const count = boxCount(name, 'unread', shape);
        expect(count).toBeGreaterThan(0);
        const presses = pressEach(name, 'unread', shape, PATH, [...Array(count).keys()]);
        expect(presses.map(judged)).toEqual(presses.map(() => 'written'));
    });
});

/**
 * Task lines of many shapes in one card, each written by its own checkbox,
 * whatever marks, links, fields of the plugin's and of Dataview's, embeds,
 * footnotes, continuations and quotes it holds. A line that repeats makes
 * its next line when it is done, and is pressed apart (`a checkbox of a
 * line that repeats`).
 */
const MANY = [
    '- [ ] plain words here',
    '- [ ] 日本語の行です',
    '- [ ] emoji 🎉 party ✅ done',
    '- [ ]    padded words   ',
    '- [ ] ',
    '- [ ] **boldword** after',
    '- [ ] *italword* and _underital_',
    '- [ ] ~~strikeword~~ kept',
    '- [ ] ==highword== lit',
    '- [ ] `codeword` run',
    '- [ ] **bold *innerital* ~~innerstrike~~ ==innerhigh==** `incode`',
    '- [ ] ***bothword***',
    '- [ ] see [[Wiki Note]]',
    '- [ ] see [[Aliased Note|shownalias]]',
    '- [ ] see [[Headed Note#Some Head]]',
    '- [ ] [linktext](https://example.com/path)',
    '- [ ] https://example.com/bare',
    '- [ ] tagged #tagword/sub',
    '- [ ] meeting @2026-10-04',
    '- [ ] slot @2026-10-04T10:00>11:00',
    '- [ ] blocked line ^abc123',
    '- [ ] due field [due:: 2026-10-04]',
    '- [ ] paren field (pkey:: pval)',
    '- [ ] end field ekey:: evalue',
    '- [ ] esc \\*star\\* \\_under\\_ \\#nottag',
    '- [ ] amp &amp; lt &lt; copy &copy; end',
    '- [ ] visible %%hiddencomment%% tail',
    '- [ ] <span class="x">spanned</span> rest',
    '- [ ] before<br>after',
    '- [ ] expr `= this.file.name`',
    '- [ ] named[^note]',
    '- [ ] picture ![[image.png]]',
    '- [ ] embedded ![[Wiki Note]]',
    '- [ ] contpara head\n\n    para continued',
    '- [ ] contlazy head\nlazy continued',
    '- [ ] contindent head\n  indent continued',
    '- [ ] parentitem\n    - childitem',
    '- [ ] parenttask\n    - [ ] childtask',
    '1. [ ] ordered item',
    '> - [ ] quoted item',
    '> [!note] Callout title\n> - [ ] callout item',
    '- [x] done item',
    '- [/] half item',
    '- [-] cancelled item',
    '- [>] forwarded item',
    '',
    '[^note]: the named note',
].join('\n');

describe('a checkbox of a task line of many shapes', () => {
    const name = 'mdwrites-many';
    const NOTE = `${PREFIX}-many`;
    const PATH = `${NOTE}.md`;
    const TAGGED = '- [ ] #tvmdwritestag opens with a tag';
    const TEXT = ['# many', MANY, '', '# tagged', TAGGED, ''].join('\n');
    const lines = TEXT.split('\n');
    /** The note's lines that hold a checkbox, under the heading `heading`, in order. */
    const boxLines = (heading: string): number[] => {
        const from = lines.indexOf(`# ${heading}`);
        const to = lines.findIndex((l, i) => i > from && l.startsWith('# '));
        return lines.flatMap((l, i) => i > from && (to < 0 || i < to) && /^[\s>]*(?:[-*+]|\d+[.)]) \[.\]/.test(l) ? [i] : []);
    };

    beforeAll(() => {
        writeNotes({ [PATH]: TEXT });
        openView(name, 'timeline-view', { showSidebar: true, sidebar: [{ kind: 'markdown', id: 'many', link: NOTE }] });
    });

    afterEach(() => writeNotes({ [PATH]: TEXT }));

    it('writes the line of each checkbox pressed in turn, and no other line', () => {
        const at = boxLines('many');
        expect(boxCount(name, 'many', 'many')).toBe(at.length);
        // One press to a call: the card's presses outlast a call's time.
        const presses = at.map((_l, i) => pressEach(name, 'many', 'many', PATH, [i])[0]);
        let expected = TEXT;
        presses.forEach((press, i) => {
            expected = turned(expected, at[i]);
            expect(press).toMatchObject({ note: expected, notices: [] });
        });
    });

    it('draws the tag a task line opens with as a tag, before and after its checkbox writes the line', () => {
        const tagOf = () => ev<string[]>(`(async () => {
            ${cardsIn(name)}
            const body = await rendered('many', 'tagged');
            return JSON.stringify([...body.querySelectorAll('li a.tag')].map(a => a.textContent));
        })()`);
        expect(tagOf()).toEqual(['#tvmdwritestag']);
        const [press] = pressEach(name, 'many', 'tagged', PATH, [0]);
        expect(press).toMatchObject({ note: TEXT.replace(TAGGED, TAGGED.replace('[ ]', '[x]')), notices: [] });
        expect(tagOf()).toEqual(['#tvmdwritestag']);
    });
});

describe('a checkbox of a card whose lines are not the note\'s in order', () => {
    const name = 'mdwrites-rows';
    const NOTE = `${PREFIX}-rows`;
    const PATH = `${NOTE}.md`;
    const TEXT = [
        '# Top',
        '- tv-color:: red',
        '',
        '- [ ] t1',
        '- [ ] t2',
        '',
        '## First',
        '- [ ] f1',
        '',
        '## Second',
        '- tv-color:: blue',
        '- [ ] s1',
        '  - [ ] s2',
        '',
        '## Third',
        '',
        '',
        '- [ ] h1',
        '',
        '- [ ] h2',
        '',
        '',
        '## Fourth',
        '- [ ] u1',
        '',
    ].join('\n');
    const lineOf = (text: string) => TEXT.split('\n').indexOf(text);

    beforeAll(() => {
        writeNotes({ [PATH]: TEXT });
        openView(name, 'timeline-view', { showSidebar: true, sidebar: [{ kind: 'markdown', id: 'rows', link: `${NOTE}#Top` }] });
    });

    afterEach(() => writeNotes({ [PATH]: TEXT }));

    it.each([
        ['under the section\'s heading, below a property line and a blank line', 0, ['- [ ] t1', '- [ ] t2']],
        ['of the first heading nested in the section', 'First', ['- [ ] f1']],
        ['below a property line, under a heading nested in the section', 'Second', ['- [ ] s1', '  - [ ] s2']],
        ['between blank lines, before the next heading', 'Third', ['- [ ] h1', '- [ ] h2']],
        ['of the last card', 'Fourth', ['- [ ] u1']],
    ])('writes the line of a card %s', (_where, which, lines) => {
        const presses = pressEach(name, 'rows', which, PATH, lines.map((_l, i) => i));
        let expected = TEXT;
        presses.forEach((press, i) => {
            expected = turned(expected, lineOf(lines[i]));
            expect(press).toMatchObject({ note: expected, notices: [] });
            expect(lines[i]).toContain(press.item);
        });
    });
});

describe('a checkbox written as HTML, above a line whose status names a line of the card', () => {
    const name = 'mdwrites-named';
    const NOTE = `${PREFIX}-named`;
    const PATH = `${NOTE}.md`;
    // The whole note is one card, its lines the note's: the item written as
    // HTML is drawn with the status that names the card's line 2, as the
    // line 2 is drawn.
    const NAMES_2 = String.fromCharCode(0xE000 + 2);
    const TEXT = [
        `<ul><li data-task="${NAMES_2}"><input type="checkbox" class="task-list-item-checkbox"> k0</li></ul>`,
        '',
        `- [${NAMES_2}] k1`,
        '- [ ] k2',
    ].join('\n');

    beforeAll(() => {
        writeNotes({ [PATH]: TEXT });
        openView(name, 'timeline-view', { showSidebar: true, sidebar: [{ kind: 'markdown', id: 'named', link: NOTE }] });
    });

    afterEach(() => writeNotes({ [PATH]: TEXT }));

    it('writes nothing for the checkbox written as HTML, and says the checkbox matches no line', () => {
        expect(boxCount(name, 'named', 0)).toBe(3);
        const [press] = pressEach(name, 'named', 0, PATH, [0]);
        expect(press.item).toBe('k0');
        expect(press).toMatchObject({ note: TEXT, notices: [tr('sidebar.checkboxUnmatched')] });
    });

    it.each([
        ['whose status names a line', 1, 2],
        ['below it', 2, 3],
    ])('writes the line of the checkbox %s', (_which, box, line) => {
        const [press] = pressEach(name, 'named', 0, PATH, [box]);
        expect(press).toMatchObject({ note: turned(TEXT, line), notices: [] });
    });
});

describe('a checkbox of a card with a dataviewjs block', () => {
    const name = 'mdwrites-script';
    const NOTE = `${PREFIX}-script`;
    const PATH = `${NOTE}.md`;
    const TEXT = [
        '# Script',
        '- [ ] scripted box',
        '',
        `${F}dataviewjs`,
        'window.__n = (window.__n || 0) + 1',
        F,
        '',
    ].join('\n');

    beforeAll(() => {
        requireDataview({ js: true });
        writeNotes({ [PATH]: TEXT });
        openView(name, 'timeline-view', { showSidebar: true, sidebar: [{ kind: 'markdown', id: 'script', link: NOTE }] });
    });

    afterAll(() => {
        ev(`(() => { delete window.__n; return JSON.stringify(true); })()`);
    });

    let refreshMs = 2500;

    /**
     * How many times the card's script runs from `change` (`click` its
     * checkbox, or `write` the note `text`) to the card drawn anew and
     * Dataview's refresh of its views after the note changed.
     */
    function runsOf(change: 'click' | 'write', text = TEXT): { runs: number; note: string } {
        return ev(`(async () => {
            ${cardsIn(name)}
            const path = ${JSON.stringify(PATH)};
            const body = await rendered('script', 'Script');
            const before = await disk(path);
            window.__n = 0;
            if (${JSON.stringify(change)} === 'click') boxesOf(body)[0].click();
            else await writeNote(path, ${JSON.stringify(text)});
            for (let i = 0; i < 50 && (await disk(path)) === before; i++) await wait(100);
            for (let i = 0; i < 50 && (cardBody('script', 'Script') === body || !(cardBody('script', 'Script')?.childElementCount > 0)); i++) await wait(100);
            for (let i = 0; i < 50 && !(window.__n >= 1); i++) await wait(100);
            await wait(${refreshMs + 1000});
            return JSON.stringify({ runs: window.__n, note: await disk(path) });
        })()`);
    }
    it('runs the script once a click is answered as often as once the note is written apart from the click', () => {
        refreshMs = ev<number>(`(() => JSON.stringify(app.plugins.plugins.dataview.settings.refreshInterval ?? 2500))()`);
        // The card drawn once from a write of the note, before what is measured.
        runsOf('write', TEXT.replace('scripted box', 'scripted box, written'));
        const written = runsOf('write');
        const clicked = runsOf('click');
        expect(clicked.note).toBe(TEXT.replace('- [ ] scripted box', '- [x] scripted box'));
        expect(written.runs).toBeGreaterThan(0);
        expect(clicked.runs).toBe(written.runs);
    });
});


describe('a checkbox of a card whose note is no longer what the card was read from', () => {
    const name = 'mdwrites-changed';
    const NOTE = `${PREFIX}-changed`;
    const PATH = `${NOTE}.md`;
    const TEXT = ['# Tasks', '- [ ] one', '- [ ] two', '- [ ] three', ''].join('\n');

    beforeAll(() => {
        writeNotes({ [PATH]: TEXT });
        openView(name, 'timeline-view', { showSidebar: true, sidebar: [{ kind: 'markdown', id: 'changed', link: NOTE }] });
    });

    afterEach(() => writeNotes({ [PATH]: TEXT }));

    it('writes nothing to a note written apart from the plugin before the frame reads it again, and says the note has changed', () => {
        const changed = TEXT.replace('- [ ] three', '- [ ] three, written elsewhere');
        const r = ev<Press>(`(async () => {
            ${cardsIn(name)}
            const body = await rendered('changed', 'Tasks');
            const seen = noticesNow();
            // The write and the click in one go: the vault hears of the
            // file's change only after this snippet yields to its watcher.
            await app.vault.adapter.write(own(${JSON.stringify(PATH)}), ${JSON.stringify(changed)});
            boxesOf(body)[1].click();
            for (let i = 0; i < 50 && noticesSince(seen).length === 0; i++) await wait(100);
            await wait(${SETTLE_MS});
            return JSON.stringify({ note: await disk(${JSON.stringify(PATH)}), notices: noticesSince(seen) });
        })()`);
        expect(r.note).toBe(changed);
        expect(r.notices).toHaveLength(1);
        expect(r.notices[0]).toContain(tr('notice.refusedChanged'));
    });

    it('writes the line the checkbox stands for once lines put above the card move it, the card not rendered again', () => {
        const moved = ['first line', 'second line', '', TEXT].join('\n');
        const body = ev<boolean>(`(async () => {
            ${cardsIn(name)}
            (await rendered('changed', 'Tasks')).__tvE2EKept = true;
            await writeNote(${JSON.stringify(PATH)}, ${JSON.stringify(moved)});
            await wait(${SETTLE_MS});
            return JSON.stringify(cardBody('changed', 'Tasks')?.__tvE2EKept === true);
        })()`);
        expect(body).toBe(true);
        const [press] = pressEach(name, 'changed', 'Tasks', PATH, [1]);
        expect(press).toMatchObject({ note: moved.replace('- [ ] two', '- [x] two'), notices: [] });
        expect(ev<boolean>(`(async () => { ${cardsIn(name)} return JSON.stringify(cardBody('changed', 'Tasks')?.__tvE2EKept === true); })()`)).toBe(false);
    });

    it('writes the first of two checkboxes of a card clicked before the frame reads the note again, and says of the second that the note has changed', () => {
        const r = ev<Press>(`(async () => {
            ${cardsIn(name)}
            const body = await rendered('changed', 'Tasks');
            const seen = noticesNow();
            const [one, , three] = boxesOf(body);
            one.click();
            three.click();
            for (let i = 0; i < 50 && noticesSince(seen).length === 0; i++) await wait(100);
            await wait(${SETTLE_MS});
            return JSON.stringify({ note: await disk(${JSON.stringify(PATH)}), notices: noticesSince(seen) });
        })()`);
        expect(r.note).toBe(TEXT.replace('- [ ] one', '- [x] one'));
        expect(r.notices).toHaveLength(1);
        expect(r.notices[0]).toContain(tr('notice.refusedChanged'));
    });
});

describe('a checkbox of a line that repeats', () => {
    const name = 'mdwrites-flow';
    const TAG = 'tvmdwritesflow';
    const FRAMED = `${PREFIX}-flow-framed`;
    const CARDED = `${PREFIX}-flow-carded`;
    const QUOTED = `${PREFIX}-flow-quoted`;
    const IGNORED = `${PREFIX}-flow-ignored`;
    const flowNote = (task: string) => ['# Flow', `- [ ] ${task} #${TAG} @2026-04-01 ==> at(start + 1d)`, ''].join('\n');
    const QUOTED_TEXT = [
        '# Quoted',
        '> - [ ] quoted flow @2026-04-01 ==> at(start + 1d)',
        '',
        '> [!note]',
        '> - [ ] called-out flow @2026-04-01 ==> at(start + 1d)',
        '',
    ].join('\n');
    const IGNORED_TEXT = [
        '---',
        'tv-ignore: true',
        '---',
        '# Ignored',
        '- [ ] ignored flow @2026-04-01 ==> at(start + 1d)',
        '- [ ] ignored plain',
        '',
    ].join('\n');
    const all = () => ({
        [`${FRAMED}.md`]: flowNote('flow task'),
        [`${CARDED}.md`]: flowNote('flow card'),
        [`${QUOTED}.md`]: QUOTED_TEXT,
        [`${IGNORED}.md`]: IGNORED_TEXT,
    });

    beforeAll(() => {
        writeNotes(all());
        openView(name, 'timeline-view', {
            showSidebar: true,
            sidebar: [
                {
                    id: 'list',
                    name: 'Tasks',
                    filterState: { logic: 'and', filters: [{ property: 'parent', operator: 'isNotSet' }, { property: 'tag', operator: 'includes', value: [TAG] }] },
                    applyViewFilter: false,
                },
                { kind: 'markdown', id: 'framed', link: FRAMED },
                { kind: 'markdown', id: 'quoted', link: QUOTED },
                { kind: 'markdown', id: 'ignored', link: IGNORED },
            ],
        });
    });

    afterEach(() => writeNotes(all()));

    it('makes its next line when it is done, as a task card\'s checkbox of the same line does', () => {
        const [press] = pressEach(name, 'framed', 'Flow', `${FRAMED}.md`, [0]);
        const carded = ev<string>(`(async () => {
            ${cardsIn(name)}
            const path = ${JSON.stringify(`${CARDED}.md`)};
            const before = await disk(path);
            const card = [...el.querySelectorAll('.pinned-list .task-card')].find(c => c.textContent.includes('flow card'));
            const box = card?.querySelector('.task-card__content > ul > li > input.task-list-item-checkbox');
            if (!box) throw new Error('no task card of ' + path);
            box.click();
            for (let i = 0; i < 50 && (await disk(path)) === before; i++) await wait(100);
            await wait(${SETTLE_MS});
            return JSON.stringify(await disk(path));
        })()`);
        expect(press.notices).toEqual([]);
        expect(press.note).not.toBe(flowNote('flow task'));
        expect(press.note.split('\n').length).toBeGreaterThan(flowNote('flow task').split('\n').length);
        expect(press.note).toBe(carded.replaceAll('flow card', 'flow task'));
    });

    it.each([
        ['a quote', 'quoted', 'Quoted', `${QUOTED}.md`, QUOTED_TEXT, 0, 1],
        ['a callout', 'quoted', 'Quoted', `${QUOTED}.md`, QUOTED_TEXT, 1, 4],
        ['a note the plugin ignores', 'ignored', 'Ignored', `${IGNORED}.md`, IGNORED_TEXT, 0, 4],
    ])('turns the status alone of one in %s, and makes no line', (_where, id, heading, path, text, box, line) => {
        const [press] = pressEach(name, id, heading, path, [box]);
        expect(press).toMatchObject({ note: turned(text, line), notices: [] });
    });

    it('turns the status of a line that does not repeat in a note the plugin ignores', () => {
        const [press] = pressEach(name, 'ignored', 'Ignored', `${IGNORED}.md`, [1]);
        expect(press).toMatchObject({ note: turned(IGNORED_TEXT, 5), notices: [] });
    });
});
