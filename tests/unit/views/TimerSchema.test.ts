import { describe, expect, it } from 'vitest';
import { TimerCodec, type TimerConfig } from '../../../src/views/TimerSchema';
import { ViewUriBuilder } from '../../../src/views/sharedLogic/ViewUriBuilder';

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

    it('writes the canonical key into a copied URI and reads it back', () => {
        const config: TimerConfig = { timerViewMode: 'interval', intervalTemplate: '朝のルーチン' };
        const uri = ViewUriBuilder.build('timer-view', { configParams: codec.toUriParams(config) });

        expect(uri).toContain('view=timer');
        expect(uri).toContain('timerViewMode=interval');
        expect(uri).not.toMatch(/[?&]mode=/);
        const query = Object.fromEntries(new URL(uri.replace('obsidian://', 'http://x/')).searchParams);
        expect(codec.fromUriParams(query)).toEqual(config);
    });

    it('reads an older URI that said `mode=`', () => {
        expect(codec.fromUriParams({ mode: 'countdown' }).timerViewMode).toBe('countdown');
    });

    it('drops a mode it does not know from a URI', () => {
        expect(codec.fromUriParams({ mode: 'stopwatch' }).timerViewMode).toBeUndefined();
    });
});
