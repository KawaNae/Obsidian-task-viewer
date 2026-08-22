import { describe, expect, it } from 'vitest';
import '../../../src/views/registerAllSchemas';
import { codecFor, shortNameFor } from '../../../src/services/viewConfig';
// 値として import すると schema 自身の registerSchema が走ってしまい、
// registerAllSchemas に載っているかを見られなくなる。型だけを借りる。
import type { TimerConfig } from '../../../src/views/TimerSchema';
import { ViewUriBuilder } from '../../../src/views/sharedLogic/ViewUriBuilder';
import {
    VIEW_META_TIMELINE,
    VIEW_META_SCHEDULE,
    VIEW_META_TIMER,
    VIEW_META_CALENDAR,
    VIEW_META_MINI_CALENDAR,
    VIEW_META_KANBAN,
} from '../../../src/constants/viewRegistry';

/**
 * タイマービューだけが schema を持たず、モードとテンプレート名がワークスペース
 * 保存に乗らないまま残っていた。短縮名も registry に無いので、view type から
 * 短縮名を引く経路（`shortNameFor`）はタイマーだけ undefined を返していた。
 */

// ViewType の全数。viewRegistry は型の union しか公開していないので、ここは
// 手で並べる（増えたときに落ちるよう、TypeScript の網羅チェックに預けたい）。
const ALL_VIEW_TYPES = [
    VIEW_META_TIMELINE.type,
    VIEW_META_SCHEDULE.type,
    VIEW_META_TIMER.type,
    VIEW_META_CALENDAR.type,
    VIEW_META_MINI_CALENDAR.type,
    VIEW_META_KANBAN.type,
];

describe('TimerSchema', () => {
    const codec = codecFor(VIEW_META_TIMER.type)!;

    it('is registered, so the registry can answer for every view type', () => {
        for (const viewType of ALL_VIEW_TYPES) {
            expect(shortNameFor(viewType), viewType).toBeDefined();
        }
    });

    it('agrees with the short name the URI builder writes', () => {
        // 短縮名の表は ViewUriBuilder にも手書きで載っている（統合は C6）。
        // 2 つが食い違うと、書いた URI を読み側が解決できなくなる。
        for (const viewType of ALL_VIEW_TYPES) {
            expect(ViewUriBuilder.build(viewType)).toContain(`view=${shortNameFor(viewType)}`);
        }
    });

    it('round-trips the mode and the selected template through the state dict', () => {
        const config: TimerConfig = {
            customName: '集中',
            timerViewMode: 'interval',
            intervalTemplate: '朝のルーチン',
        };
        const dict = codec.serializeConfig(config);
        expect(codec.parseConfig(dict)).toEqual(config);
    });

    it('drops a mode it does not know instead of adopting it', () => {
        expect(codec.parseConfig({ timerViewMode: 'stopwatch' }).timerViewMode).toBeUndefined();
    });

    it('reads the mode written by an older URI as `mode`', () => {
        expect(codec.parseConfig({ mode: 'countdown' }).timerViewMode).toBe('countdown');
    });

    it('omits keys that have no value, so an untouched view saves nothing', () => {
        expect(codec.serializeConfig({})).toEqual({});
    });
});
