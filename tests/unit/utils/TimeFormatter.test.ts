import { describe, it, expect } from 'vitest';
import { TimeFormatter } from '../../../src/utils/TimeFormatter';

describe('TimeFormatter: a duration as the timers show it', () => {
    it('is MM:SS under an hour', () => {
        expect(TimeFormatter.formatSeconds(0)).toBe('00:00');
        expect(TimeFormatter.formatSeconds(65.9)).toBe('01:05');
        expect(TimeFormatter.formatSeconds(3599)).toBe('59:59');
        expect(TimeFormatter.formatSeconds(-5)).toBe('00:00');
    });

    it('is H:MM:SS from an hour on, the hours as many as they are', () => {
        expect(TimeFormatter.formatSeconds(3600)).toBe('1:00:00');
        expect(TimeFormatter.formatSeconds(3600 + 5 * 60 + 3)).toBe('1:05:03');
        expect(TimeFormatter.formatSeconds(125 * 3600 + 59)).toBe('125:00:59');
    });

    it('signs an overrun, in either form', () => {
        expect(TimeFormatter.formatSignedSeconds(-65)).toBe('-01:05');
        expect(TimeFormatter.formatSignedSeconds(-3665)).toBe('-1:01:05');
        expect(TimeFormatter.formatSignedSeconds(65)).toBe('01:05');
    });
});
