import { describe, it, expect } from 'vitest';
import { shouldRenderForChanges } from '../../../src/views/sharedUI/RenderScheduler';

describe('shouldRenderForChanges', () => {
    it('skips render when every changed key is internal (blockId / timerTargetId)', () => {
        expect(shouldRenderForChanges(['blockId'])).toBe(false);
        expect(shouldRenderForChanges(['timerTargetId'])).toBe(false);
        expect(shouldRenderForChanges(['blockId', 'timerTargetId'])).toBe(false);
    });

    it('renders when any changed key has visual effect', () => {
        expect(shouldRenderForChanges(['statusChar'])).toBe(true);
        expect(shouldRenderForChanges(['startDate'])).toBe(true);
        // mixed: a visual key alongside an internal one still renders
        expect(shouldRenderForChanges(['timerTargetId', 'statusChar'])).toBe(true);
    });

    it('renders when change info is absent (undefined / empty) — cannot prove it is a no-op', () => {
        expect(shouldRenderForChanges(undefined)).toBe(true);
        expect(shouldRenderForChanges([])).toBe(true);
    });
});
