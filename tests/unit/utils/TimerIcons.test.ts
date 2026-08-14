import { describe, expect, it } from 'vitest';
import {
    TIMER_ICONS,
    TIMER_ICON_PREFIX_RE,
    getTimerIcon,
    withTimerIcon,
} from '../../../src/utils/TimerIcons';

/**
 * アイコンの一覧は「付ける側（タイマー）」と「剥がす側（フロー発火）」で
 * 共有する。別々に持っていた頃は `🔁` が剥がす側に無く、次インスタンスの
 * 名前に残り続けた。ここで一覧と両方向の対応を pin する。
 */
describe('TimerIcons', () => {
    it('付けうるアイコンは剥がす側の一覧に必ず含まれる', () => {
        const produced = [
            getTimerIcon('countup'),
            getTimerIcon('countdown'),
            getTimerIcon('interval', 'pomodoro'),
            getTimerIcon('interval'),
        ];
        for (const icon of produced) {
            expect(TIMER_ICONS).toContain(icon);
        }
    });

    it('種別ごとのアイコン', () => {
        expect(getTimerIcon('countup')).toBe('⏱️');
        expect(getTimerIcon('countdown')).toBe('⏲️');
        expect(getTimerIcon('interval', 'pomodoro')).toBe('🍅');
        expect(getTimerIcon('interval')).toBe('🔁');
        expect(getTimerIcon('idle')).toBe('⏱️');
    });

    it('先頭の既知アイコンを剥がす', () => {
        for (const icon of TIMER_ICONS) {
            expect(`${icon} 週報`.replace(TIMER_ICON_PREFIX_RE, '')).toBe('週報');
        }
    });

    it('アイコンを含まない内容は変えない', () => {
        expect('週報'.replace(TIMER_ICON_PREFIX_RE, '')).toBe('週報');
        // 行の途中のアイコンは名前の一部なので剥がさない。
        expect('週報 ⏱️'.replace(TIMER_ICON_PREFIX_RE, '')).toBe('週報 ⏱️');
    });

    it('withTimerIcon は種類の違うアイコンも剥がしてから前置する', () => {
        // 旧アイコン（⏳）で書かれたレコードを起点に「続き」を始めても重ならない。
        expect(withTimerIcon('⏲️', '⏳ 週報')).toBe('⏲️ 週報');
        expect(withTimerIcon('⏱️', '⏱️ 週報')).toBe('⏱️ 週報');
        expect(withTimerIcon('⏱️', '週報')).toBe('⏱️ 週報');
    });

    it('名前が空ならアイコンだけになる', () => {
        expect(withTimerIcon('⏱️', '')).toBe('⏱️');
        expect(withTimerIcon('⏱️', '   ')).toBe('⏱️');
        expect(withTimerIcon('⏱️', '⏱️')).toBe('⏱️');
    });
});
