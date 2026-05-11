import { describe, expect, it } from 'vitest';
import { TimelineResizeGesture } from '../../../src/interaction/drag/strategies/timeline/TimelineResizeGesture';

/**
 * computeResizeDeltas は snapped logical Y (column 上端からの px) と initial
 * state から resize 帰結の (logicalTop, logicalHeight) を計算する pure helper。
 *  - direction='bottom': top 固定で height 伸縮
 *  - direction='top'   : bottom 固定で top と height 連動
 *  - 最小高 = 15 分 * zoomLevel px (15 分 snap と一貫)
 *
 * 全座標は logical px (= minutes * zoomLevel)。zoomLevel が CSS の
 * --hour-height / 60 と一致する前提なので、CSS 変数 (`--start-minutes`,
 * `--duration-minutes`) への書き戻し時に zoomLevel で割って分単位に戻す。
 */
describe('TimelineResizeGesture.computeResizeDeltas', () => {
    describe('direction=bottom (height 伸縮、top 固定)', () => {
        it('extends height when pointer moves below initialBottom', () => {
            // initial: top=100, bottom=200 (height=100)。pointer at y=300 → newH=200
            const r = TimelineResizeGesture.computeResizeDeltas(300, 100, 200, 'bottom', 1);
            expect(r).toEqual({ logicalTop: 100, logicalHeight: 200 });
        });

        it('shrinks height when pointer moves between top and bottom', () => {
            // initial: top=100, bottom=200。pointer at y=150 → newH=50
            const r = TimelineResizeGesture.computeResizeDeltas(150, 100, 200, 'bottom', 1);
            expect(r).toEqual({ logicalTop: 100, logicalHeight: 50 });
        });

        it('clamps to minimum 15-minute height when pointer is at/above initialTop', () => {
            // pointer at y=100 (= top) → newH would be 0, but clamp to 15
            const r = TimelineResizeGesture.computeResizeDeltas(100, 100, 200, 'bottom', 1);
            expect(r).toEqual({ logicalTop: 100, logicalHeight: 15 });
        });

        it('respects zoomLevel for minimum height', () => {
            // zoomLevel=2 → min height = 30 logical px (15 min * 2 px/min)
            const r = TimelineResizeGesture.computeResizeDeltas(100, 100, 200, 'bottom', 2);
            expect(r).toEqual({ logicalTop: 100, logicalHeight: 30 });
        });
    });

    describe('direction=top (bottom 固定、top と height 連動)', () => {
        it('raises top when pointer moves above initialTop', () => {
            // initial: top=100, bottom=200。pointer at y=50 → newTop=50, newH=150
            const r = TimelineResizeGesture.computeResizeDeltas(50, 100, 200, 'top', 1);
            expect(r).toEqual({ logicalTop: 50, logicalHeight: 150 });
        });

        it('lowers top when pointer moves below initialTop but above bottom', () => {
            // pointer at y=150 → newTop=150, newH=50
            const r = TimelineResizeGesture.computeResizeDeltas(150, 100, 200, 'top', 1);
            expect(r).toEqual({ logicalTop: 150, logicalHeight: 50 });
        });

        it('clamps newTop so height stays >= 15 minutes (pointer at/below bottom)', () => {
            // pointer at y=200 (= bottom) → newH would be 0, clamp 15 → newTop=185
            const r = TimelineResizeGesture.computeResizeDeltas(200, 100, 200, 'top', 1);
            expect(r).toEqual({ logicalTop: 185, logicalHeight: 15 });
        });

        it('respects zoomLevel for minimum height (top direction)', () => {
            // zoomLevel=2 → min=30, pointer at y=200 → newTop=170, newH=30
            const r = TimelineResizeGesture.computeResizeDeltas(200, 100, 200, 'top', 2);
            expect(r).toEqual({ logicalTop: 170, logicalHeight: 30 });
        });
    });

    describe('zoomLevel proportionality (CSS 変数所有との整合)', () => {
        it('produces logicalTop / zoomLevel = minutes consistent across zoom', () => {
            // zoom=1 で top=120 logical → 120 分。zoom=2 で同じ pointer 位置なら
            // logical も 2 倍になるので minutes は変わらない。
            const z1 = TimelineResizeGesture.computeResizeDeltas(120, 60, 180, 'top', 1);
            const z2 = TimelineResizeGesture.computeResizeDeltas(240, 120, 360, 'top', 2);
            expect(z1.logicalTop / 1).toBe(z2.logicalTop / 2);
            expect(z1.logicalHeight / 1).toBe(z2.logicalHeight / 2);
        });
    });
});
