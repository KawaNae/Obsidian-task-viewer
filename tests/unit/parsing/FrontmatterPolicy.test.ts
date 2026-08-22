import { describe, it, expect } from 'vitest';
import { isTaskBearingFile, reservedPropertyKeys } from '../../../src/services/parsing/utils/FrontmatterPolicy';
import { DEFAULT_TV_FILE_KEYS } from '../../../src/types';

const keys = DEFAULT_TV_FILE_KEYS;

describe('isTaskBearingFile', () => {
    it('returns false when frontmatter is undefined', () => {
        expect(isTaskBearingFile(undefined, keys)).toBe(false);
    });

    it('returns false for frontmatter with no signal keys', () => {
        expect(isTaskBearingFile({ title: 'x', author: 'y' }, keys)).toBe(false);
    });

    it('returns true when tags key exists (any value)', () => {
        expect(isTaskBearingFile({ tags: [] }, keys)).toBe(true);
        expect(isTaskBearingFile({ tags: ['work'] }, keys)).toBe(true);
        expect(isTaskBearingFile({ tags: null }, keys)).toBe(true);
    });

    it('returns true for any fmKey except ignore', () => {
        expect(isTaskBearingFile({ [keys.start]: '2026-01-01' }, keys)).toBe(true);
        expect(isTaskBearingFile({ [keys.end]: '2026-01-01' }, keys)).toBe(true);
        expect(isTaskBearingFile({ [keys.due]: '2026-01-01' }, keys)).toBe(true);
        expect(isTaskBearingFile({ [keys.status]: 'x' }, keys)).toBe(true);
        expect(isTaskBearingFile({ [keys.content]: 'My Task' }, keys)).toBe(true);
        expect(isTaskBearingFile({ [keys.timerTargetId]: 'id' }, keys)).toBe(true);
        expect(isTaskBearingFile({ [keys.color]: 'red' }, keys)).toBe(true);
        expect(isTaskBearingFile({ [keys.linestyle]: 'solid' }, keys)).toBe(true);
        expect(isTaskBearingFile({ [keys.mask]: 'foo' }, keys)).toBe(true);
    });

    it('does not treat ignore key as a participation signal', () => {
        expect(isTaskBearingFile({ [keys.ignore]: false }, keys)).toBe(false);
        expect(isTaskBearingFile({ [keys.ignore]: true }, keys)).toBe(false);
    });

    it('treats empty string key value as present', () => {
        expect(isTaskBearingFile({ [keys.color]: '' }, keys)).toBe(true);
        expect(isTaskBearingFile({ [keys.status]: null }, keys)).toBe(true);
    });

    it('respects custom fmKey names', () => {
        const customKeys = { ...keys, start: 'my-start', color: 'my-color' };
        expect(isTaskBearingFile({ 'my-start': '2026-01-01' }, customKeys)).toBe(true);
        expect(isTaskBearingFile({ 'my-color': 'red' }, customKeys)).toBe(true);
        expect(isTaskBearingFile({ [keys.start]: '2026-01-01' }, customKeys)).toBe(false);
    });
});

describe('reservedPropertyKeys', () => {
    it('covers every declaration key', () => {
        const reserved = reservedPropertyKeys(keys);
        for (const key of Object.values(keys)) {
            expect(reserved.has(key)).toBe(true);
        }
    });

    // `tags` has its own field; `position` is written by Obsidian's metadata
    // cache. Neither is a declaration key, and neither may be a custom one.
    it.each(['tags', 'position'])('reserves %s', (key) => {
        expect(reservedPropertyKeys(keys).has(key)).toBe(true);
    });

    it('leaves an ordinary key alone', () => {
        const reserved = reservedPropertyKeys(keys);
        expect(reserved.has('金額')).toBe(false);
        expect(reserved.has('project')).toBe(false);
    });

    it('follows renamed fmKeys, and frees the default name they left', () => {
        const custom = { ...keys, content: 'my-content' };
        const reserved = reservedPropertyKeys(custom);
        expect(reserved.has('my-content')).toBe(true);
        expect(reserved.has('tv-content')).toBe(false);
    });
});
