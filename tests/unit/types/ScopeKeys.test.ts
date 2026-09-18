import { describe, it, expect } from 'vitest';
import { DEFAULT_SCOPE_KEYS, normalizeScopeKeys, validateScopeKeys } from '../../../src/types';

describe('normalizeScopeKeys', () => {
    // A settings file saved by the file-task era carries status / content /
    // timerTargetId. They name nothing now and must not survive the next save.
    it('drops the keys the file task used', () => {
        const normalized = normalizeScopeKeys({ ...DEFAULT_SCOPE_KEYS, status: 'tv-status', content: 'tv-content', timerTargetId: 'tv-timer-target-id' });
        expect(normalized).toEqual(DEFAULT_SCOPE_KEYS);
        expect(Object.keys(normalized)).toHaveLength(7);
    });

    it('keeps a renamed key and fills a blank or missing one with its default', () => {
        const normalized = normalizeScopeKeys({ start: '  my-start ', end: '', color: 7 });
        expect(normalized.start).toBe('my-start');
        expect(normalized.end).toBe(DEFAULT_SCOPE_KEYS.end);
        expect(normalized.color).toBe(DEFAULT_SCOPE_KEYS.color);
        expect(normalized.ignore).toBe(DEFAULT_SCOPE_KEYS.ignore);
    });
});

describe('validateScopeKeys', () => {
    it('accepts the defaults', () => {
        expect(validateScopeKeys(DEFAULT_SCOPE_KEYS)).toBeNull();
    });

    it('rejects a duplicate name', () => {
        expect(validateScopeKeys({ ...DEFAULT_SCOPE_KEYS, end: 'tv-start' })).toMatch(/unique/);
    });
});
