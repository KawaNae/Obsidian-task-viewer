import { describe, expect, it } from 'vitest';
import { TimelineCodec, effectiveOverlapMode, type TimelineConfig } from '../../../../src/views/timelineview/TimelineSchema';
import { ViewUriBuilder } from '../../../../src/views/sharedLogic/ViewUriBuilder';

describe('TimelineSchema overlapMode', () => {
    const codec = TimelineCodec;

    it('round-trips each way of laying out through a template\'s dict', () => {
        for (const overlapMode of ['cascade', 'auto', 'sideBySide'] as const) {
            const dict = codec.serializeConfig({ overlapMode });
            expect(dict).toEqual({ overlapMode });
            expect(codec.parseConfig(dict).overlapMode).toBe(overlapMode);
        }
    });

    it('writes it into a copied URI and reads it back', () => {
        const config: TimelineConfig = { overlapMode: 'sideBySide' };
        const uri = ViewUriBuilder.build('timeline-view', { configParams: codec.toUriParams(config) });
        expect(uri).toContain('overlapMode=sideBySide');
        const query = Object.fromEntries(new URL(uri.replace('obsidian://', 'http://x/')).searchParams);
        expect(codec.fromUriParams(query).overlapMode).toBe('sideBySide');
    });

    it('drops a way of laying out it does not know', () => {
        expect(codec.parseConfig({ overlapMode: 'side' }).overlapMode).toBeUndefined();
        expect(codec.fromUriParams({ overlapMode: 'side' }).overlapMode).toBeUndefined();
        expect(codec.serializeConfig({ overlapMode: 'side' as never })).toEqual({});
    });

    it('leaves a view saved without it following the global setting, over a state that had one', () => {
        const before = { overlapMode: 'sideBySide' as const };
        const state = { ...before, ...codec.withDefaults(codec.parseConfig({ daysToShow: 7 })) };
        expect(state).toHaveProperty('overlapMode', undefined);
        expect(codec.withDefaults({})).toHaveProperty('overlapMode', undefined);
    });

    it('takes the view\'s own way of laying out over the global setting, and the global one where it has none', () => {
        expect(effectiveOverlapMode({ overlapMode: 'cascade' }, { overlapMode: 'sideBySide' })).toBe('cascade');
        expect(effectiveOverlapMode({}, { overlapMode: 'sideBySide' })).toBe('sideBySide');
        expect(effectiveOverlapMode({ overlapMode: undefined }, { overlapMode: 'auto' })).toBe('auto');
    });
});
