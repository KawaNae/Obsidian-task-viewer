import { describe, it, expect } from 'vitest';
import { reservedPropertyKeys } from '../../../src/services/parsing/utils/FrontmatterPolicy';
import { DEFAULT_TV_FILE_KEYS } from '../../../src/types';

const keys = DEFAULT_TV_FILE_KEYS;

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
