import { describe, it, expect } from 'vitest';
import { nameOf, namesOfReading, namesOutsideIndex, readName } from '../../../../src/services/core/RowNames';

describe('RowNames', () => {
    const READING = 'mugdzal02.3';

    describe('nameOf / readName', () => {
        it('is the path, the reading and the line', () => {
            expect(nameOf('tv-inline', 'a/b.md', 4, READING)).toBe(`tv-inline:a/b.md:n:${READING}:4`);
        });

        it('reads back what it says, a path holding a colon too', () => {
            const name = nameOf('tv-inline', 'a:b.md', 4, READING);
            expect(readName(name)).toEqual({ parserId: 'tv-inline', filePath: 'a:b.md', reading: READING, line: 4 });
        });

        it('reads nothing of an ID of another shape', () => {
            expect(readName('tv-inline:a.md:seq:7')).toBeNull();
            expect(readName('not-an-id')).toBeNull();
            expect(readName('invalid')).toBeNull();
        });

        // `seq:`, `blk:`, `tid:`, `ln:` and `fm-root` came before names; no ID
        // of those shapes is minted or persisted any more.
        it.each(['ln:3', 'blk:abc', 'tid:tv-t-1', 'seq:7', 'fm-root'])('does not read %s', anchor => {
            expect(readName(`tv-inline:a.md:${anchor}`)).toBeNull();
        });
    });

    describe('namesOfReading', () => {
        it('names a row by the reading and its line, and tells it the reading', () => {
            expect(namesOfReading('a.md', READING)('tv-inline', 2)).toEqual({ id: nameOf('tv-inline', 'a.md', 2, READING), reading: READING });
        });
    });

    describe('namesOutsideIndex', () => {
        it('is line-based, whatever block ID the line carries, and has no reading', () => {
            expect(namesOutsideIndex('a.md')('tv-inline', 5)).toEqual({ id: 'tv-inline:a.md:prov:5' });
        });

        it('never reads as a name', () => {
            expect(readName(namesOutsideIndex('a.md')('tasks-plugin', 0).id)).toBeNull();
        });
    });
});
