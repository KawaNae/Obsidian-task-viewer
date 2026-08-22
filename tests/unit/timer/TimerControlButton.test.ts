import { describe, expect, it } from 'vitest';
import { createControlButton } from '../../../src/timer/TimerControlButton';

/**
 * 操作ボタンの組み立て。アイコンを span ラッパー越しに入れる形を固定する
 * （WebKit は inline-flex ボタン直下の SVG を描かない）。ラベルとの間隔は
 * CSS の gap が持つので、文字列の先頭に空白を入れない。
 *
 * 実 DOM は要らないので、createEl / createSpan だけを持つ最小の器で受ける。
 */

interface FakeEl {
    tag: string;
    cls: string;
    text: string;
    children: FakeEl[];
    onclick?: () => void;
    createEl(tag: string, options?: { cls?: string; text?: string }): FakeEl;
    createSpan(options?: { cls?: string; text?: string }): FakeEl;
}

function fakeEl(tag: string, cls = '', text = ''): FakeEl {
    const node: FakeEl = {
        tag,
        cls,
        text,
        children: [],
        createEl(childTag, options) {
            const child = fakeEl(childTag, options?.cls ?? '', options?.text ?? '');
            node.children.push(child);
            return child;
        },
        createSpan(options) {
            return node.createEl('span', options);
        },
    };
    return node;
}

function build(block: string) {
    const container = fakeEl('div');
    const clicks: number[] = [];
    const btn = createControlButton(container as unknown as HTMLElement, {
        block,
        variant: 'primary',
        icon: 'play',
        label: '開始',
        onClick: () => clicks.push(1),
    }) as unknown as FakeEl;
    return { container, btn, clicks };
}

describe('createControlButton', () => {
    it('names the button from the block it belongs to', () => {
        expect(build('timer-widget').btn.cls).toBe('timer-widget__btn timer-widget__btn--primary');
        expect(build('timer-view').btn.cls).toBe('timer-view__btn timer-view__btn--primary');
    });

    it('puts the icon in a span instead of hanging it under the button', () => {
        const { btn } = build('timer-view');
        expect(btn.children.map((c) => c.tag)).toEqual(['span', 'span']);
        expect(btn.children[0].cls).toBe('timer-view__btn-icon');
    });

    it('writes the label as given, with no leading space', () => {
        const { btn } = build('timer-widget');
        expect(btn.children[1].text).toBe('開始');
    });

    it('appends the button to the container and wires the click', () => {
        const { container, btn, clicks } = build('timer-widget');
        expect(container.children).toHaveLength(1);
        btn.onclick?.();
        expect(clicks).toHaveLength(1);
    });
});

/**
 * 同じボタンを手で組み直すと、span ラッパーも gap の前提も崩れる。呼び出し側に
 * 手組みが残っていないことをソースレベルで固定する（3 箇所に散っていた）。
 */
describe('control buttons are not hand-rolled any more', () => {
    const files = [
        { path: 'src/timer/TimerRenderer.ts', block: 'timer-widget' },
        { path: 'src/views/TimerView.ts', block: 'timer-view' },
    ];

    it.each(files)('$path builds no $block button by hand', async ({ path, block }) => {
        const { readFileSync } = await import('node:fs');
        const source = readFileSync(path, 'utf8');
        expect(source).not.toContain(`${block}__btn ${block}__btn--`);
    });
});
