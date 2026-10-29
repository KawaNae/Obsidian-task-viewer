import { describe, it, expect } from 'vitest';
import { TimeFormatter } from '../../../src/utils/TimeFormatter';

describe('TimeFormatter: a duration as the timers show it', () => {
    it('is MM:SS below 1000 minutes, the minutes as many as they are', () => {
        expect(TimeFormatter.formatSeconds(0)).toBe('00:00');
        expect(TimeFormatter.formatSeconds(65.9)).toBe('01:05');
        expect(TimeFormatter.formatSeconds(3600)).toBe('60:00');
        expect(TimeFormatter.formatSeconds(140 * 60 + 3)).toBe('140:03');
        expect(TimeFormatter.formatSeconds(1000 * 60 - 1)).toBe('999:59');
        expect(TimeFormatter.formatSeconds(-5)).toBe('00:00');
    });

    it('is H:MM:SS from 1000 minutes on, the hours as many as they are', () => {
        expect(TimeFormatter.formatSeconds(1000 * 60)).toBe('16:40:00');
        expect(TimeFormatter.formatSeconds(125 * 3600 + 59)).toBe('125:00:59');
    });

    it('signs an overrun, in either form', () => {
        expect(TimeFormatter.formatSignedSeconds(-65)).toBe('-01:05');
        expect(TimeFormatter.formatSignedSeconds(-3665)).toBe('-61:05');
        expect(TimeFormatter.formatSignedSeconds(-1000 * 60 - 5)).toBe('-16:40:05');
        expect(TimeFormatter.formatSignedSeconds(65)).toBe('01:05');
    });
});
