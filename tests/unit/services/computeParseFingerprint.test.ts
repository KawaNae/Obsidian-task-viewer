import { describe, it, expect } from 'vitest';
import { computeParseFingerprint } from '../../../src/services/core/TaskIndex';
import { DEFAULT_SETTINGS } from '../../../src/types';

describe('computeParseFingerprint', () => {
    it('returns same fingerprint for identical settings', () => {
        const a = { ...DEFAULT_SETTINGS };
        const b = { ...DEFAULT_SETTINGS };
        expect(computeParseFingerprint(a)).toBe(computeParseFingerprint(b));
    });

    it('detects tvFileKeys change even on same object reference', () => {
        const settings = { ...DEFAULT_SETTINGS, tvFileKeys: { ...DEFAULT_SETTINGS.tvFileKeys } };
        const before = computeParseFingerprint(settings);
        settings.tvFileKeys.start = 'custom-start';
        const after = computeParseFingerprint(settings);
        expect(before).not.toBe(after);
    });

    it('detects enableDayPlanner toggle on same object', () => {
        const settings = { ...DEFAULT_SETTINGS };
        const before = computeParseFingerprint(settings);
        settings.enableDayPlanner = true;
        const after = computeParseFingerprint(settings);
        expect(before).not.toBe(after);
    });

    it('detects enableTasksPlugin toggle on same object', () => {
        const settings = { ...DEFAULT_SETTINGS };
        const before = computeParseFingerprint(settings);
        settings.enableTasksPlugin = true;
        const after = computeParseFingerprint(settings);
        expect(before).not.toBe(after);
    });

    it('detects tvFileChildHeader change on same object', () => {
        const settings = { ...DEFAULT_SETTINGS };
        const before = computeParseFingerprint(settings);
        settings.tvFileChildHeader = 'Custom Header';
        const after = computeParseFingerprint(settings);
        expect(before).not.toBe(after);
    });

    it('ignores display-only key changes (startHour)', () => {
        const settings = { ...DEFAULT_SETTINGS };
        const before = computeParseFingerprint(settings);
        settings.startHour = 8;
        const after = computeParseFingerprint(settings);
        expect(before).toBe(after);
    });

    it('ignores display-only key changes (weekStartDay)', () => {
        const settings = { ...DEFAULT_SETTINGS };
        const before = computeParseFingerprint(settings);
        settings.weekStartDay = 1;
        const after = computeParseFingerprint(settings);
        expect(before).toBe(after);
    });
});
