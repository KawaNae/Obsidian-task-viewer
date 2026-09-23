import { describe, it, expect } from 'vitest';
import { Outline } from '../../../src/services/parsing/utils/Outline';

describe('Outline line relations', () => {
    it('VERBATIM holds only for the same characters, indentation included', () => {
        expect(Outline.VERBATIM.holds('\t- [ ] a', '\t- [ ] a')).toBe(true);
        expect(Outline.VERBATIM.holds('\t- [ ] a', '    - [ ] a')).toBe(false);
        expect(Outline.VERBATIM.holds('- [ ] a', '- [ ] a ')).toBe(false);
    });

    it('UP_TO_INDENT holds for lines that differ in their indentation alone', () => {
        expect(Outline.UP_TO_INDENT.holds('\t- [ ] a', '    - [ ] a')).toBe(true);
        expect(Outline.UP_TO_INDENT.holds('- [ ] a', '\t\t- [ ] a')).toBe(true);
        expect(Outline.UP_TO_INDENT.holds('- [ ] a', '- [ ] b')).toBe(false);
        // A full-width or a no-break space is no indentation (R0)
        expect(Outline.UP_TO_INDENT.holds('　- [ ] a', '- [ ] a')).toBe(false);
        expect(Outline.UP_TO_INDENT.holds(' - [ ] a', '- [ ] a')).toBe(false);
    });

    it('holds exactly when the keys are equal', () => {
        const lines = ['- [ ] a', '\t- [ ] a', '    - [ ] a', '- [ ] b', '　- [ ] a', ''];
        for (const relation of [Outline.VERBATIM, Outline.UP_TO_INDENT]) {
            for (const a of lines) {
                for (const b of lines) {
                    expect(relation.holds(a, b)).toBe(relation.key(a) === relation.key(b));
                }
            }
        }
    });
});
