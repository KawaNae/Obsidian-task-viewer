import { describe, expect, it } from 'vitest';
import { autoGrowTextarea } from '../../../src/utils/TextareaAutoGrow';

/**
 * `scrollHeight` は「非表示中は 0」という DOM の性質を持つ。触ってしまうと
 * `height:0px` が焼き付き、表示に戻っても 1px のまま固まる（display:none →
 * render のタイミングで実機再現）。fake element の style は plain object
 * なので実 DOM は要らない。
 */
function fakeEl(scrollHeight: number): HTMLElement {
    return {
        scrollHeight,
        style: { height: '' } as CSSStyleDeclaration,
    } as unknown as HTMLElement;
}

describe('autoGrowTextarea', () => {
    it('leaves style.height untouched when scrollHeight is 0 (hidden ancestor)', () => {
        const el = fakeEl(0);
        el.style.height = '114px'; // 修正前に焼き付いた縮み値を模す
        autoGrowTextarea(el);
        expect(el.style.height).toBe('114px');
    });

    it('sets style.height to the measured scrollHeight when visible', () => {
        const el = fakeEl(152);
        autoGrowTextarea(el);
        expect(el.style.height).toBe('152px');
    });
});
