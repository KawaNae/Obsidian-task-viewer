import { describe, it, expect } from 'vitest';
import { reservedPropertyKeys } from '../../../src/services/parsing/utils/FrontmatterPolicy';
import { DEFAULT_SCOPE_KEYS } from '../../../src/types';

const keys = DEFAULT_SCOPE_KEYS;

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

    it('follows renamed scope keys, and frees the default name they left', () => {
        const custom = { ...keys, color: 'my-color' };
        const reserved = reservedPropertyKeys(custom);
        expect(reserved.has('my-color')).toBe(true);
        expect(reserved.has('tv-color')).toBe(false);
    });

    // Notes written for the file task still carry its keys. Left unreserved, a
    // leftover `tv-status` would be inherited as a custom property and show up
    // on every card in the note — and a timer closed after the upgrade leaves
    // its `tv-timer-target-id` behind in the frontmatter.
    it.each(['tv-status', 'tv-content', 'tv-timer-target-id'])('still reserves the file task\'s %s', (key) => {
        expect(reservedPropertyKeys(keys).has(key)).toBe(true);
    });
});
