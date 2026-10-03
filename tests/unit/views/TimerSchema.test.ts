import { describe, expect, it } from 'vitest';
import { TimerCodec, type TimerConfig } from '../../../src/views/TimerSchema';

describe('TimerSchema', () => {
    const codec = TimerCodec;

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
