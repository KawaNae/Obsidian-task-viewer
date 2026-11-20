import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Notice } from '../../mocks/obsidian';
import { t } from '../../../../src/i18n';
import { contentKeyOf, type ContentKey } from '../../../../src/services/core/ContentKey';
import { MARKED_LINES, type BoxLine } from '../../../../src/services/data/FrameCheckboxes';
import type { CardContent, MarkdownFrameCardHost } from '../../../../src/views/sidebar/MarkdownFrameCard';
import { FakeEl, type FakeEvent } from '../../helpers/cardDom';

/**
 * A click of a checkbox in a markdown frame's card, over a stand-in DOM. The
 * render is stood in for as Obsidian draws what a card reads of it: a
 * `li.task-list-item` with its `data-task` (the status, a space as nothing)
 * and a checkbox for each task line, a quote's too, an indented one in the
 * item above it; an item written as HTML with the `data-task` it writes; a
 * note embedded (`![[…]]`) as an `.internal-embed` holding a task of its
 * own; a Dataview block as a `.block-language-dataview` holding one; and an
 * inline Dataview query as Dataview's task list, drawn only by a render
 * whose component is loaded. Every render the card asks for is kept.
 */

const renders: { markdown: string; loaded: boolean }[] = [];

vi.mock('obsidian', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('obsidian');
    class Component {
        loaded = false;
        private readonly ends: (() => void)[] = [];
        load() { this.loaded = true; }
        unload() { for (const end of this.ends.splice(0)) end(); }
        register(end: () => void) { this.ends.push(end); }
        registerDomEvent(el: FakeEl, type: string, fn: (e: FakeEvent) => void) {
            el.addEventListener(type, fn);
            this.ends.push(() => el.removeEventListener(type, fn));
        }
    }
    return {
        ...actual,
        Component,
        MarkdownRenderer: {
            render: (_app: unknown, markdown: string, el: FakeEl, _path: string, component: Component) => {
                renders.push({ markdown, loaded: component.loaded });
                drawn(markdown, el, component.loaded);
                return Promise.resolve();
            },
        },
    };
});

/** An item with a checkbox in `parent`, its `data-task` as written; `cls` added to both. */
function item(parent: FakeEl, task: string, cls = ''): FakeEl {
    const li = parent.createEl('li', { cls: `task-list-item ${cls}` });
    li.setAttribute('data-task', task);
    li.createEl('input', { cls: `task-list-item-checkbox ${cls}` });
    return li;
}

/** `markdown` as the stand-in render draws it into `el`, in order. */
function drawn(markdown: string, el: FakeEl, loaded: boolean): void {
    let ul: FakeEl | null = null;
    let last: FakeEl | null = null;
    for (const line of markdown.split('\n')) {
        const box = line.match(/^(?:>\s?)*(\s*)- \[(.)\]/);
        const html = line.match(/^<li data-task="(.*)">/);
        if (box && box[1] !== '' && last) item(last.createEl('ul'), box[2] === ' ' ? '' : box[2]);
        else if (box) last = item(ul ??= el.createEl('ul'), box[2] === ' ' ? '' : box[2]);
        else if (html) item(el.createEl('ul'), html[1]);
        else if (/^!\[\[.*\]\]$/.test(line)) item(el.createEl('span', { cls: 'internal-embed' }).createEl('ul'), '');
        else if (line === '```dataview') item(el.createDiv('block-language-dataview').createEl('ul'), '');
        else if (line === '`$= dv.taskList()`' && loaded) item(el.createEl('span').createDiv('dataview result-group').createEl('ul'), '', 'dataview');
        if (!box) ul = last = null;
    }
}

class StandInObserver {
    observe() {}
    disconnect() {}
}

beforeEach(() => {
    Notice.messages = [];
    renders.length = 0;
    vi.stubGlobal('document', { createElement: (tag: string) => new FakeEl(tag) });
    vi.stubGlobal('MutationObserver', StandInObserver);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

const PATH = 'Habits.md';
const STYLE = { color: null, linestyle: null, opensWithHeading: false };

/** A body of `markdown` on the note's lines from `from` on, read from the note whose lines are `note`. */
function body(markdown: string, from = 0, note: string[] = markdown.split('\n')): CardContent & { kind: 'body' } {
    const lines = markdown.split('\n').map((_, k) => from + k);
    return { kind: 'body', markdown, path: PATH, key: contentKeyOf(note), lines };
}

/** Let the renders a click waits for end. */
const settled = () => new Promise(resolve => setTimeout(resolve, 0));

async function card(content: CardContent) {
    const { MarkdownFrameCard } = await import('../../../../src/views/sidebar/MarkdownFrameCard');
    const writes: { path: string; key: ContentKey; write: BoxLine }[] = [];
    const host: MarkdownFrameCardHost = {
        app: {} as MarkdownFrameCardHost['app'],
        bindLinks: () => {},
        remove: () => {},
        relink: () => {},
        writeBox: (path, key, write) => writes.push({ path, key, write }),
    };
    const it = new MarkdownFrameCard(host, content, STYLE);
    const el = it.el as unknown as FakeEl;
    const rendered = () => el.querySelector('.markdown-frame__content')!;
    return {
        card: it,
        writes,
        /** Click the checkbox `index` of those drawn, in an embed or a block too: whether the click was kept from toggling it. */
        click(index: number): boolean {
            let prevented = false;
            const box = rendered().querySelectorAll('input.task-list-item-checkbox')[index];
            rendered().fire('click', { target: box, preventDefault: () => { prevented = true; } });
            return prevented;
        },
    };
}

describe("a click of a markdown frame card's checkbox", () => {
    it("writes the checkbox's line, at the key and the lines the card was read with", async () => {
        const content = body('- [ ] a\n- [x] b', 4);
        const { card: c, writes, click } = await card(content);
        c.paint(true);

        expect(click(1)).toBe(true);
        await settled();
        expect(writes).toEqual([{ path: PATH, key: content.key, write: { line: 5, text: '- [x] b', next: '- [ ] b' } }]);
        expect(Notice.messages).toEqual([]);
    });

    it('renders twice, never shown and with no component loaded: each line named, then the line turned', async () => {
        const { card: c, click } = await card(body('- [ ] a\n- [ ] b'));
        c.paint(true);
        renders.length = 0;

        click(1);
        await settled();
        expect(renders).toEqual([
            { markdown: `- [${String.fromCharCode(0xE000)}] a\n- [${String.fromCharCode(0xE001)}] b`, loaded: false },
            { markdown: '- [ ] a\n- [x] b', loaded: false },
        ]);
    });

    it('writes a nested line and one in a quote, each at its own line', async () => {
        const { card: c, writes, click } = await card(body('- [ ] a\n  - [ ] b\n\n> - [/] c'));
        c.paint(true);

        click(1);
        click(2);
        await settled();
        expect(writes.map(w => w.write)).toEqual([
            { line: 1, text: '  - [ ] b', next: '  - [x] b' },
            { line: 3, text: '> - [/] c', next: '> - [ ] c' },
        ]);
    });

    it('writes at the key and the lines handed last, when the card was handed them with the same markdown and not rendered again', async () => {
        const markdown = '- [ ] a\n- [ ] b';
        const { card: c, writes, click } = await card(body(markdown, 0));
        c.paint(true);
        const moved = body(markdown, 2, ['new', 'line', ...markdown.split('\n')]);
        c.set(moved, STYLE);
        c.paint(true);

        click(0);
        await settled();
        expect(writes).toEqual([{ path: PATH, key: moved.key, write: { line: 2, text: '- [ ] a', next: '- [x] a' } }]);
    });

    it('writes at the key, the lines and the path it rendered, while it shows a markdown other than the one it was handed last', async () => {
        const shown = body('- [ ] a\n- [ ] b', 3, ['x', 'y', 'z', '- [ ] a', '- [ ] b']);
        const { card: c, writes, click } = await card(shown);
        c.paint(true);
        c.set(body('- [ ] new\n- [ ] a\n- [ ] b', 0), STYLE);
        c.paint(false);

        expect(click(1)).toBe(true);
        await settled();
        expect(writes).toEqual([{ path: PATH, key: shown.key, write: { line: 4, text: '- [ ] b', next: '- [x] b' } }]);
        expect(Notice.messages).toEqual([]);
    });

    it('writes at the reading of the click, though the card is handed another and rendered anew before the renders end', async () => {
        const first = body('- [ ] a\n- [ ] b', 0);
        const { card: c, writes, click } = await card(first);
        c.paint(true);

        click(1);
        c.set(body('- [ ] b', 0), STYLE);
        c.paint(true);
        await settled();
        expect(writes).toEqual([{ path: PATH, key: first.key, write: { line: 1, text: '- [ ] b', next: '- [x] b' } }]);
    });

    it('writes nothing, and says so, for a checkbox written as HTML, whose status names no line', async () => {
        const { card: c, writes, click } = await card(body('<li data-task="x">\n\n- [ ] b'));
        c.paint(true);

        expect(click(0)).toBe(true);
        await settled();
        expect(writes).toEqual([]);
        expect(Notice.messages).toEqual([t('sidebar.checkboxUnmatched')]);
    });

    it("writes nothing for a checkbox written as HTML whose status names a task line's, and writes that line's own", async () => {
        const named = String.fromCharCode(0xE002);
        const { card: c, writes, click } = await card(body(`<li data-task="${named}">\n\n- [${named}] b\n- [ ] c`));
        c.paint(true);

        click(0);
        await settled();
        expect(writes).toEqual([]);
        expect(Notice.messages).toEqual([t('sidebar.checkboxUnmatched')]);

        click(1);
        await settled();
        expect(writes.map(w => w.write)).toEqual([{ line: 2, text: `- [${named}] b`, next: '- [ ] b' }]);
    });

    it(`writes nothing, and says so, for a checkbox of a line past the first ${MARKED_LINES}`, async () => {
        const { card: c, writes, click } = await card(body(Array.from({ length: MARKED_LINES + 1 }, () => '- [ ] a').join('\n')));
        c.paint(true);

        click(MARKED_LINES - 1);
        await settled();
        expect(writes.map(w => w.write.line)).toEqual([MARKED_LINES - 1]);

        click(MARKED_LINES);
        await settled();
        expect(writes).toHaveLength(1);
        expect(Notice.messages).toEqual([t('sidebar.checkboxUnmatched')]);
    });

    it('writes nothing, and says so, for a checkbox drawn in the heading over a mask, which holds no lines', async () => {
        const { card: c, writes } = await card({ kind: 'mask', heading: '- [ ] a', text: '***', path: PATH });
        c.paint(true);
        const heading = (c.el as unknown as FakeEl).querySelector('.markdown-frame__heading')!;
        let prevented = false;
        heading.fire('click', { target: heading.querySelectorAll('input.task-list-item-checkbox')[0], preventDefault: () => { prevented = true; } });
        await settled();

        expect(prevented).toBe(true);
        expect(writes).toEqual([]);
        expect(Notice.messages).toEqual([t('sidebar.checkboxUnmatched')]);
    });

    it('writes nothing, and says so, for a checkbox of an embedded note, which is kept from toggling', async () => {
        const { card: c, writes, click } = await card(body('- [ ] a\n![[Other#Tasks]]\n- [ ] b'));
        c.paint(true);

        expect(click(1)).toBe(true);
        await settled();
        expect(writes).toEqual([]);
        expect(Notice.messages).toEqual([t('sidebar.checkboxUnmatched')]);
    });

    it('takes the checkboxes past an embedded note without it', async () => {
        const { card: c, writes, click } = await card(body('- [ ] a\n![[Other#Tasks]]\n- [ ] b'));
        c.paint(true);

        click(2);
        await settled();
        expect(writes.map(w => w.write)).toEqual([{ line: 2, text: '- [ ] b', next: '- [x] b' }]);
    });

    it("leaves a code block's checkbox to the block, and takes the checkboxes past it without it", async () => {
        const { card: c, writes, click } = await card(body('- [ ] a\n```dataview\nTASK\n```\n- [ ] b'));
        c.paint(true);

        expect(click(1)).toBe(false);
        click(2);
        await settled();
        expect(writes.map(w => w.write)).toEqual([{ line: 4, text: '- [ ] b', next: '- [x] b' }]);
        expect(Notice.messages).toEqual([]);
    });

    it("leaves an inline query's checkbox to Dataview, and takes the checkboxes past it without it", async () => {
        const { card: c, writes, click } = await card(body('- [ ] a\n`$= dv.taskList()`\n- [ ] b'));
        c.paint(true);

        expect(click(1)).toBe(false);
        click(2);
        await settled();
        expect(writes.map(w => w.write)).toEqual([{ line: 2, text: '- [ ] b', next: '- [x] b' }]);
        expect(Notice.messages).toEqual([]);
    });
});
