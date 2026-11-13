import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FrameCard } from '../../../../src/services/data/MarkdownFrames';
import type { FrameRead } from '../../../../src/views/sidebar/MarkdownFrameReader';
import type { MarkdownFrameViewHost } from '../../../../src/views/sidebar/MarkdownFrameView';

/**
 * A markdown frame's view over a stand-in DOM: the cards it draws for what
 * was read, and when it renders their markdown. Obsidian's renderer is
 * stood in for as it behaves: the markdown is in the element when the call
 * returns, and the call's promise settles later.
 */

/** Each call of the renderer: the markdown, the element it drew into, the path, and whether its component was unloaded. */
const renders = vi.hoisted(() => [] as { markdown: string; el: FakeNode; path: string; component: { unloaded: boolean } }[]);

vi.mock('obsidian', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('obsidian');
    class Component {
        unloaded = false;
        private readonly ends: (() => void)[] = [];
        load() {}
        unload() {
            this.unloaded = true;
            for (const end of this.ends.splice(0)) end();
        }
        register(end: () => void) { this.ends.push(end); }
        registerDomEvent() {}
    }
    return {
        ...actual,
        Component,
        MarkdownRenderer: {
            render: (_app: unknown, markdown: string, el: FakeNode, path: string, component: Component) => {
                el.createDiv({ cls: 'rendered', text: markdown });
                renders.push({ markdown, el, path, component });
                return Promise.resolve();
            },
        },
    };
});

/** The header row, stood in for: its name, its fold, and the fold a click of it works. */
const rows = vi.hoisted(() => [] as { name: string; collapsed: boolean; click(): void }[]);

vi.mock('../../../../src/views/sharedUI/ListSectionRenderer', () => ({
    renderSectionHeader: (root: FakeNode, params: { name: string; collapsed: boolean; onCollapsedChange(next: boolean): void }) => {
        const row = {
            name: params.name,
            collapsed: params.collapsed,
            click() {
                row.collapsed = !row.collapsed;
                params.onCollapsedChange(row.collapsed);
            },
        };
        rows.push(row);
        return {
            header: root.createDiv('row'),
            nameEl: { setText: (text: string) => { row.name = text; } },
            setCollapsed: (collapsed: boolean) => { row.collapsed = collapsed; },
        };
    },
}));

/** An element of the stand-in DOM, with what the view and its cards touch. */
class FakeNode {
    readonly children: FakeNode[] = [];
    parent: FakeNode | null = null;
    readonly classes = new Set<string>();
    readonly dataset: Record<string, string> = {};
    readonly props = new Map<string, string>();
    readonly style = {
        setProperty: (k: string, v: string) => { this.props.set(k, v); },
        removeProperty: (k: string) => { this.props.delete(k); },
    };
    text = '';
    /** How many times it was taken out of the element it stood in and put in again: what has an iframe in it load again. */
    moves = 0;
    /** Set on the stand-in document's body: an element under it is in a document. */
    document = false;

    constructor(cls = '') {
        this.addClass(...cls.split(/\s+/).filter(Boolean));
    }

    get isConnected(): boolean {
        return this.document || (this.parent?.isConnected ?? false);
    }
    addClass(...cls: string[]) { cls.forEach(c => this.classes.add(c)); }
    removeClass(...cls: string[]) { cls.forEach(c => this.classes.delete(c)); }
    toggleClass(cls: string, on: boolean) { if (on) this.addClass(cls); else this.removeClass(cls); }
    createDiv(o: string | { cls?: string; text?: string } = {}): FakeNode {
        const { cls, text } = typeof o === 'string' ? { cls: o, text: '' } : o;
        const el = new FakeNode(cls);
        el.text = text ?? '';
        this.insertBefore(el, null);
        return el;
    }
    createEl(_tag: string, o: { cls?: string; text?: string } = {}): FakeNode { return this.createDiv(o); }
    insertBefore(el: FakeNode, before: FakeNode | null): void {
        if (el.parent) el.moves++;
        el.remove();
        el.parent = this;
        const at = before === null ? -1 : this.children.indexOf(before);
        if (at < 0) this.children.push(el);
        else this.children.splice(at, 0, el);
    }
    remove(): void {
        if (!this.parent) return;
        this.parent.children.splice(this.parent.children.indexOf(this), 1);
        this.parent = null;
    }
    addEventListener() {}
    /** The descendants with the class `cls`, in order. */
    all(cls: string): FakeNode[] {
        return this.children.flatMap(child => [...(child.classes.has(cls) ? [child] : []), ...child.all(cls)]);
    }
    get textContent(): string {
        return this.text + this.children.map(c => c.textContent).join('');
    }
}

class StandInObserver {
    observe() {}
    disconnect() {}
}

beforeEach(() => {
    renders.length = 0;
    rows.length = 0;
    vi.stubGlobal('document', { createElement: () => new FakeNode() });
    vi.stubGlobal('MutationObserver', StandInObserver);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

const PATH = 'Habits.md';

/** A card of the markdown `markdown`, opened by `heading`, with no style and no mask unless `more` gives one. */
const card = (heading: string | null, markdown: string, more: Partial<FrameCard> = {}): FrameCard =>
    ({ heading, markdown, color: null, linestyle: null, mask: null, ...more });

/** What a frame read of the whole note at `path`: `cards`. */
const noteOf = (cards: FrameCard[], path = PATH): FrameRead => ({ reading: { kind: 'note', cards }, title: 'Habits', path });

async function frameView(options: { collapsed?: boolean; placed?: boolean; masked?: boolean } = {}) {
    const { MarkdownFrameView } = await import('../../../../src/views/sidebar/MarkdownFrameView');
    const state = { masked: options.masked ?? false, canRender: true };
    const relinks: string[] = [];
    const host = {
        app: {},
        rowClasses: { header: 'h', toggle: 't', name: 'n', button: 'b', collapsed: 'markdown-frame--collapsed' },
        canRender: () => state.canRender,
        bindLinks: () => {},
        masked: () => state.masked,
        collapsedChanged: () => {},
        showMenu: () => {},
        remove: () => relinks.push('remove'),
        relink: () => relinks.push('relink'),
    } as unknown as MarkdownFrameViewHost;
    const view = new MarkdownFrameView(host, 'f', 'Habits', options.collapsed ?? false);
    const root = view.root as unknown as FakeNode;
    const body = new FakeNode();
    body.document = true;
    /** Put the frame in a document, as the panel does. */
    const place = () => body.insertBefore(root, null);
    if (options.placed ?? true) place();
    const cardsEl = () => root.all('markdown-frame__cards')[0];
    return {
        view,
        root,
        state,
        relinks,
        place,
        row: () => rows.at(-1)!,
        /** The cards' elements, in order. */
        cards: () => cardsEl().children,
        /** The element each card's markdown was rendered into, in order; null for a card that shows none. */
        contents: () => cardsEl().children.map(el => el.all('markdown-frame__content')[0] ?? null),
        /** The text each card shows, in order. */
        texts: () => cardsEl().children.map(el => el.textContent),
    };
}

describe('the cards of a markdown frame', () => {
    it('draws a card for each card read, in order, each styled by its section, and renders each once', async () => {
        const f = await frameView();
        f.view.show(noteOf([
            card(null, 'intro'),
            card('## Words', '## Words\nw', { color: '#ff0000' }),
            card('## Reading', '## Reading\nr', { linestyle: 'dashed' }),
        ]));
        expect(f.texts()).toEqual(['intro', '## Words\nw', '## Reading\nr']);
        expect(renders.map(r => [r.markdown, r.path])).toEqual([['intro', PATH], ['## Words\nw', PATH], ['## Reading\nr', PATH]]);
        expect(f.cards().map(el => el.children[0].classes.has('task-card__shape'))).toEqual([true, true, true]);
        expect(f.cards().map(el => [el.props.has('--file-accent'), el.dataset.fileLinestyle ?? null])).toEqual([
            [false, null],
            [true, null],
            [false, 'dashed'],
        ]);
    });

    it('renders again only the card whose markdown changed, and keeps the others\' elements', async () => {
        const f = await frameView();
        f.view.show(noteOf([card('## A', '## A\na'), card('## B', '## B\nb'), card('## C', '## C\nc')]));
        const [cards, contents] = [[...f.cards()], f.contents()];
        renders.length = 0;

        f.view.show(noteOf([card('## A', '## A\na'), card('## B', '## B\nb, more'), card('## C', '## C\nc')]));
        expect(renders.map(r => r.markdown)).toEqual(['## B\nb, more']);
        expect(f.cards()).toEqual(cards);
        expect(f.cards().map(el => el.moves)).toEqual([0, 0, 0]);
        expect([f.contents()[0], f.contents()[2]]).toEqual([contents[0], contents[2]]);
        expect(f.contents()[1]).not.toBe(contents[1]);
        expect(f.texts()).toEqual(['## A\na', '## B\nb, more', '## C\nc']);
    });

    it('renders only the card added, and moves no other card', async () => {
        const f = await frameView();
        f.view.show(noteOf([card('## A', '## A'), card('## C', '## C')]));
        const [a, c] = f.contents();
        renders.length = 0;

        f.view.show(noteOf([card('## A', '## A'), card('## B', '## B'), card('## C', '## C')]));
        expect(renders.map(r => r.markdown)).toEqual(['## B']);
        expect(f.texts()).toEqual(['## A', '## B', '## C']);
        expect([f.contents()[0], f.contents()[2]]).toEqual([a, c]);
        expect([f.cards()[0].moves, f.cards()[2].moves]).toEqual([0, 0]);
    });

    it('takes out a card no longer read, ending its render, and renders nothing for the others', async () => {
        const f = await frameView();
        f.view.show(noteOf([card('## A', '## A'), card('## B', '## B'), card('## C', '## C')]));
        const [a, , c] = f.contents();
        const ofB = renders[1].component;
        renders.length = 0;

        f.view.show(noteOf([card('## A', '## A'), card('## C', '## C')]));
        expect(renders).toEqual([]);
        expect(ofB.unloaded).toBe(true);
        expect(f.contents()).toEqual([a, c]);
        expect(f.cards().map(el => el.moves)).toEqual([0, 0]);
    });

    it('puts the cards in their new order without rendering any, each its element still', async () => {
        const f = await frameView();
        f.view.show(noteOf([card('## A', '## A'), card('## B', '## B'), card('## C', '## C')]));
        const [a, b, c] = f.contents();
        renders.length = 0;

        f.view.show(noteOf([card('## C', '## C'), card('## A', '## A'), card('## B', '## B')]));
        expect(renders).toEqual([]);
        expect(f.contents()).toEqual([c, a, b]);
        // Only the card out of its place is moved.
        expect(f.cards().map(el => el.moves)).toEqual([1, 0, 0]);
    });

    it('keeps a card that shows the same as another as its own, card by card', async () => {
        const f = await frameView();
        f.view.show(noteOf([card('## A', '## A'), card('## X', '## X'), card('## A', '## A')]));
        const [first, x, second] = f.contents();
        renders.length = 0;

        f.view.show(noteOf([card('## X', '## X'), card('## A', '## A'), card('## A', '## A')]));
        expect(renders).toEqual([]);
        expect(f.contents()).toEqual([x, first, second]);
    });

    it('styles a card anew without rendering it when only its style changed, nor for a new name', async () => {
        const f = await frameView();
        f.view.show(noteOf([card('## A', '## A'), card('## B', '## B')]));
        const contents = f.contents();
        renders.length = 0;

        f.view.show({ ...noteOf([card('## A', '## A', { color: '#00ff00', linestyle: 'dotted' }), card('## B', '## B')]), title: 'Renamed' });
        expect(renders).toEqual([]);
        expect(f.contents()).toEqual(contents);
        expect(f.cards()[0].dataset.fileLinestyle).toBe('dotted');
        expect(f.cards()[0].props.has('--file-accent')).toBe(true);
        expect(f.row().name).toBe('Renamed');
    });

    it('renders every card again against a new path', async () => {
        const f = await frameView();
        f.view.show(noteOf([card('## A', '## A'), card('## B', '## B')]));
        renders.length = 0;
        f.view.show(noteOf([card('## A', '## A'), card('## B', '## B')], 'Moved/Habits.md'));
        expect(renders.map(r => [r.markdown, r.path])).toEqual([['## A', 'Moved/Habits.md'], ['## B', 'Moved/Habits.md']]);
    });
});

describe('when a markdown frame renders its cards', () => {
    it('renders no card while folded, and those it has to at the unfold', async () => {
        const f = await frameView({ collapsed: true });
        f.view.show(noteOf([card('## A', '## A'), card('## B', '## B')]));
        expect(renders).toEqual([]);
        expect(f.texts()).toEqual(['', '']);

        f.row().click();
        expect(renders.map(r => r.markdown)).toEqual(['## A', '## B']);
    });

    it('keeps a card\'s older markdown while folded, and renders only the cards that changed at the unfold', async () => {
        const f = await frameView();
        f.view.show(noteOf([card('## A', '## A'), card('## B', '## B')]));
        const [a, b] = f.contents();
        f.view.setCollapsed(true);
        renders.length = 0;

        f.view.show(noteOf([card('## A', '## A'), card('## B', '## B, more'), card('## C', '## C')]));
        expect(renders).toEqual([]);
        expect(f.contents()).toEqual([a, b, null]);

        f.view.setCollapsed(false);
        expect(renders.map(r => r.markdown)).toEqual(['## B, more', '## C']);
        expect(f.contents()[0]).toBe(a);
    });

    it('takes out, while folded, a card rendered against a path the note is no longer at', async () => {
        const f = await frameView();
        f.view.show(noteOf([card('## A', '## A')]));
        f.view.setCollapsed(true);
        f.view.show(noteOf([card('## A', '## A')], 'Moved/Habits.md'));
        expect(f.contents()).toEqual([null]);
        expect(renders[0].component.unloaded).toBe(true);
    });

    it('renders nothing before it is in a document, nor while the panel cannot render, and renders at the paint after', async () => {
        const f = await frameView({ placed: false });
        f.view.show(noteOf([card(null, 'a')]));
        expect(renders).toEqual([]);
        f.place();
        f.state.canRender = false;
        f.view.paint();
        expect(renders).toEqual([]);
        f.state.canRender = true;
        f.view.paint();
        expect(renders.map(r => r.markdown)).toEqual(['a']);
    });

    it('ends every card\'s render at close', async () => {
        const f = await frameView();
        f.view.show(noteOf([card('## A', '## A'), card('## B', '## B')]));
        f.view.close();
        expect(renders.map(r => r.component.unloaded)).toEqual([true, true]);
        expect(f.cards()).toEqual([]);
    });
});

describe('a markdown frame while the view masks', () => {
    const cards = [
        card(null, 'intro', { mask: 'hidden intro' }),
        card('## Words', '## Words\nw', { mask: 'hidden words' }),
        card('## Reading', '## Reading\nr'),
    ];

    it('shows a card\'s mask in place of its markdown, under its heading when one opens it, and keeps a card without a mask as it is', async () => {
        const f = await frameView();
        f.view.show(noteOf(cards));
        const reading = f.contents()[2];
        renders.length = 0;

        f.state.masked = true;
        f.view.paint();
        expect(f.contents()).toEqual([null, null, reading]);
        expect(f.texts()).toEqual(['hidden intro', '## Wordshidden words', '## Reading\nr']);
        expect(f.cards()[1].all('markdown-frame__heading')).toHaveLength(1);
        expect(renders.map(r => [r.markdown, r.path])).toEqual([['## Words', PATH]]);
        expect(renders.length).toBe(1);
    });

    it('renders again only the masked cards once the view stops masking', async () => {
        const f = await frameView({ masked: true });
        f.view.show(noteOf(cards));
        const reading = f.contents()[2];
        const ofHeading = renders.find(r => r.markdown === '## Words')!.component;
        renders.length = 0;

        f.state.masked = false;
        f.view.paint();
        expect(renders.map(r => r.markdown)).toEqual(['intro', '## Words\nw']);
        expect(ofHeading.unloaded).toBe(true);
        expect(f.contents()[2]).toBe(reading);
    });

    it('shows a lead card\'s mask while folded, and renders a heading over a mask only at the unfold', async () => {
        const f = await frameView({ masked: true, collapsed: true });
        f.view.show(noteOf(cards));
        expect(renders).toEqual([]);
        expect(f.texts()).toEqual(['hidden intro', '', '']);
        f.view.setCollapsed(false);
        expect(f.texts()).toEqual(['hidden intro', '## Wordshidden words', '## Reading\nr']);
    });
});

describe('a markdown frame whose note or section is not there', () => {
    it('says which in a single card, with Choose again and Remove, and draws the section\'s cards once it is found', async () => {
        const f = await frameView();
        f.view.show({ reading: { kind: 'no-note' }, title: 'Habits', path: null });
        expect(f.cards()).toHaveLength(1);
        expect(f.root.classes.has('markdown-frame--missing')).toBe(true);
        expect(f.cards()[0].all('markdown-frame__missing-reason')).toHaveLength(1);
        expect(f.cards()[0].all('markdown-frame__missing-relink')).toHaveLength(1);
        expect(f.cards()[0].all('markdown-frame__missing-remove')).toHaveLength(1);

        f.view.show({ reading: { kind: 'no-heading' }, title: 'Habits', path: PATH });
        expect(f.cards()).toHaveLength(1);

        f.view.show(noteOf([card('## A', '## A'), card('## B', '## B')]));
        expect(f.root.classes.has('markdown-frame--missing')).toBe(false);
        expect(f.texts()).toEqual(['## A', '## B']);
        expect(f.cards().flatMap(el => el.all('markdown-frame__missing'))).toEqual([]);
    });
});
