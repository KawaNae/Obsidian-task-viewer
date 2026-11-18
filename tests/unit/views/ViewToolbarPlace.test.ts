import { describe, it, expect } from 'vitest';
import { ViewToolbarBase } from '../../../src/views/sharedUI/ViewToolbar';

/**
 * A toolbar is put in its view's place once (`place`), and brought up to the
 * view's state at each draw (`sync`): its root stays in the place for the
 * view's life, and only a toolbar whose content follows the state builds
 * its content again.
 */

/** An element of a stand-in DOM: what `place` and `sync` touch. */
class El {
    readonly children: El[] = [];
    constructor(readonly cls = '') {}
    createDiv(cls = ''): El {
        const el = new El(cls);
        this.children.push(el);
        return el;
    }
    empty(): void { this.children.length = 0; }
}

const asEl = (el: El) => el as unknown as HTMLElement;

/** A toolbar that counts its builds and updates; each build adds one button. */
class CountingToolbar extends ViewToolbarBase {
    builds = 0;
    updates = 0;
    /** What `update` saw: the number of buttons in the root then. */
    buttonsAtUpdate: number[] = [];

    constructor(dynamicContent: boolean) {
        super({ dynamicContent });
    }

    protected buildDom(rootEl: HTMLElement): void {
        this.builds++;
        (rootEl as unknown as El).createDiv(`button-${this.builds}`);
    }

    update(): void {
        this.updates++;
        this.buttonsAtUpdate.push((this.getRootEl() as unknown as El).children.length);
    }
}

describe('ViewToolbarBase.place', () => {
    it('makes one root in the place and builds its content, then updates it', () => {
        const slot = new El('tv-view__toolbar-host');
        const toolbar = new CountingToolbar(false);
        toolbar.place(asEl(slot));

        expect(slot.children).toHaveLength(1);
        const root = slot.children[0];
        expect(root.cls).toBe('view-toolbar');
        expect(toolbar.getRootEl()).toBe(asEl(root));
        expect(root.children.map(c => c.cls)).toEqual(['button-1']);
        expect(toolbar.builds).toBe(1);
        expect(toolbar.buttonsAtUpdate).toEqual([1]);
    });
});

describe('ViewToolbarBase.sync', () => {
    it('a static toolbar keeps its content and updates it', () => {
        const slot = new El();
        const toolbar = new CountingToolbar(false);
        toolbar.place(asEl(slot));
        const root = slot.children[0];
        const button = root.children[0];

        toolbar.sync();
        toolbar.sync();

        expect(toolbar.builds).toBe(1);
        expect(toolbar.updates).toBe(3);
        expect(root.children).toEqual([button]);
    });

    it('a dynamic toolbar builds its content again in the same root, then updates it', () => {
        const slot = new El();
        const toolbar = new CountingToolbar(true);
        toolbar.place(asEl(slot));

        toolbar.sync();

        expect(toolbar.builds).toBe(2);
        expect(slot.children[0].children.map(c => c.cls)).toEqual(['button-2']);
        expect(toolbar.buttonsAtUpdate).toEqual([1, 1]);
    });

    it('leaves the root in its place, the one element there', () => {
        for (const dynamic of [false, true]) {
            const slot = new El();
            const toolbar = new CountingToolbar(dynamic);
            toolbar.place(asEl(slot));
            const root = slot.children[0];

            toolbar.sync();

            expect(slot.children).toEqual([root]);
            expect(toolbar.getRootEl()).toBe(asEl(root));
        }
    });

    it('does nothing before the toolbar is placed', () => {
        const toolbar = new CountingToolbar(true);
        toolbar.sync();

        expect(toolbar.builds).toBe(0);
        expect(toolbar.updates).toBe(0);
    });
});
