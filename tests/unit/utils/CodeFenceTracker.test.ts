import { describe, it, expect } from 'vitest';
import { CodeFenceTracker } from '../../../src/utils/CodeFenceTracker';

describe('CodeFenceTracker.opening', () => {
    it('reads the character, the length and the trimmed info string', () => {
        expect(CodeFenceTracker.opening('```  tv-gen  週報  ')).toEqual({ char: '`', length: 3, info: 'tv-gen  週報' });
        expect(CodeFenceTracker.opening('~~~~')).toEqual({ char: '~', length: 4, info: '' });
    });

    it('is null for fewer than three', () => {
        expect(CodeFenceTracker.opening('``')).toBeNull();
    });

    it('rejects a backtick fence whose info string contains a backtick', () => {
        expect(CodeFenceTracker.opening('``` a`b')).toBeNull();
        expect(CodeFenceTracker.opening('~~~ a`b')).not.toBeNull();
    });
});

describe('CodeFenceTracker.closes', () => {
    const open = CodeFenceTracker.opening('````')!;

    it('closes on the same character with at least the same length', () => {
        expect(CodeFenceTracker.closes('````', open)).toBe(true);
        expect(CodeFenceTracker.closes('`````  ', open)).toBe(true);
    });

    it('does not close on a shorter run, another character or an info string', () => {
        expect(CodeFenceTracker.closes('```', open)).toBe(false);
        expect(CodeFenceTracker.closes('~~~~', open)).toBe(false);
        expect(CodeFenceTracker.closes('```` js', open)).toBe(false);
    });
});
