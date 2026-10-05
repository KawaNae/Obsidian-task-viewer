import { describe, it, expect } from 'vitest';
import { Outline } from '../../../src/services/parsing/utils/Outline';

describe('Outline.verbatim', () => {
    it('holds only for the same characters, indentation included', () => {
        expect(Outline.verbatim('\t- [ ] a', '\t- [ ] a')).toBe(true);
        expect(Outline.verbatim('\t- [ ] a', '    - [ ] a')).toBe(false);
        expect(Outline.verbatim('- [ ] a', '- [ ] a ')).toBe(false);
    });
});
