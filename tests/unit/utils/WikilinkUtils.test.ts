import { describe, it, expect } from 'vitest';
import { extractWikilinkTarget } from '../../../src/utils/WikilinkUtils';

describe('extractWikilinkTarget', () => {
    it('strips alias after pipe', () => {
        expect(extractWikilinkTarget('SomeFile|Display Name')).toBe('SomeFile');
    });

    it('trims whitespace', () => {
        expect(extractWikilinkTarget('  Other  ')).toBe('Other');
    });

    it('returns target unchanged when no alias', () => {
        expect(extractWikilinkTarget('FileName')).toBe('FileName');
    });
});
