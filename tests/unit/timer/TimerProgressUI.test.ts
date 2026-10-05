import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TimerProgressUI, type RingOptions, type RingState } from '../../../src/timer/TimerProgressUI';

/**
 * 輪の描画。`progressOf` が答えた姿を、渡されたブロックの下に描く。クラスは
 * ブロックから作り（`timer-widget__…` と `timer-view__…`）、輪の色は状態の名前
 * （work、break、prepare、suspended、overtime、plain）で付く。
 *
 * DOM は持たないので、描画が触る口だけを持つ代役の要素で見る。
 */

class FakeEl {
    children: FakeEl[] = [];
    attrs = new Map<string, string>();
    classes = new Set<string>();
    text = '';
    dataset: Record<string, string> = {};
    parent: FakeEl | null = null;

    constructor(cls = '') {
        for (const c of cls.split(/\s+/).filter(Boolean)) this.classes.add(c);
    }

    setAttribute(name: string, value: string): void {
        this.attrs.set(name, value);
        if (name === 'class') this.classes = new Set(value.split(/\s+/).filter(Boolean));
    }

    appendChild(child: FakeEl): void {
        child.parent = this;
        this.children.push(child);
    }

    createDiv(cls = ''): FakeEl {
        const child = new FakeEl(cls);
        this.appendChild(child);
        return child;
    }

    setText(text: string): void { this.text = text; }
    addClass(cls: string): void { this.classes.add(cls); }
    toggleClass(cls: string, on: boolean): void {
        if (on) this.classes.add(cls);
        else this.classes.delete(cls);
    }

    remove(): void {
        if (!this.parent) return;
        this.parent.children = this.parent.children.filter(c => c !== this);
        this.parent = null;
    }

    /** `.a` か `[data-repeat-display="ring"]` だけを読む。 */
    querySelector(selector: string): FakeEl | null {
        const match = (el: FakeEl): boolean => selector.startsWith('.')
            ? el.classes.has(selector.slice(1))
            : el.dataset.repeatDisplay === 'ring';
        for (const child of this.children) {
            if (match(child)) return child;
            const found = child.querySelector(selector);
            if (found) return found;
        }
        return null;
    }

    /** 子孫をすべて。 */
    all(): FakeEl[] {
        return this.children.flatMap(c => [c, ...c.all()]);
    }
}

const options = (block: RingOptions['block']): RingOptions => ({ block, size: 100, format: s => `${s}s` });

function ring(overrides: Partial<RingState> = {}): RingState {
    return { displaySeconds: 75, ring: 0.25, countupLike: false, tone: 'break', repeatText: 'Break 2/4', ...overrides };
}

const progressOfEl = (root: FakeEl, block: string) =>
    root.all().find(el => el.classes.has(`${block}__progress-ring-progress`))!;

describe('TimerProgressUI', () => {
    beforeEach(() => {
        (globalThis as unknown as { document: unknown }).document = {
            createElementNS: () => new FakeEl(),
        };
    });
    afterEach(() => {
        delete (globalThis as unknown as { document?: unknown }).document;
    });

    it('draws under the block it is given, the ring coloured by the tone', () => {
        const root = new FakeEl();
        TimerProgressUI.render(root as unknown as HTMLElement, ring(), options('timer-view'));

        expect(root.all().some(el => el.classes.has('timer-view__progress-ring'))).toBe(true);
        expect([...progressOfEl(root, 'timer-view').classes]).toEqual([
            'timer-view__progress-ring-progress',
            'timer-view__progress-ring-progress--break',
        ]);
        expect(root.querySelector('.timer-view__time-display')?.text).toBe('75s');
        expect(root.querySelector('[data-repeat-display="ring"]')?.text).toBe('Break 2/4');
        expect(root.all().some(el => [...el.classes].some(c => c.startsWith('timer-widget__')))).toBe(false);
    });

    it('a countup-like reading counts up, and no repeat text is drawn without a round', () => {
        const root = new FakeEl();
        TimerProgressUI.render(root as unknown as HTMLElement,
            ring({ tone: 'suspended', countupLike: true, repeatText: null }), options('timer-widget'));

        expect(progressOfEl(root, 'timer-widget').classes.has('timer-widget__progress-ring-progress--suspended')).toBe(true);
        expect(root.querySelector('.timer-widget__time-display')?.classes.has('timer-widget__time-display--countup')).toBe(true);
        expect(root.querySelector('[data-repeat-display="ring"]')).toBeNull();
    });

    it('update moves the ring, its tone and the time, and removes the repeat text when the round is gone', () => {
        const root = new FakeEl();
        TimerProgressUI.render(root as unknown as HTMLElement, ring(), options('timer-widget'));
        const before = progressOfEl(root, 'timer-widget').attrs.get('stroke-dashoffset');

        TimerProgressUI.update(root as unknown as HTMLElement,
            ring({ ring: 0.5, tone: 'overtime', displaySeconds: -30, countupLike: true, repeatText: null }), options('timer-widget'));

        const circle = progressOfEl(root, 'timer-widget');
        expect(circle.attrs.get('stroke-dashoffset')).not.toBe(before);
        expect(circle.classes.has('timer-widget__progress-ring-progress--overtime')).toBe(true);
        expect(circle.classes.has('timer-widget__progress-ring-progress--break')).toBe(false);
        const time = root.querySelector('.timer-widget__time-display')!;
        expect(time.text).toBe('-30s');
        expect(time.classes.has('timer-widget__time-display--countup')).toBe(true);
        expect(root.querySelector('[data-repeat-display="ring"]')).toBeNull();
    });
});
