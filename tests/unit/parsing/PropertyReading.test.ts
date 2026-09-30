import { describe, it, expect } from 'vitest';
import { FileParsePipeline } from '../../../src/services/parsing/FileParsePipeline';
import { namesOutsideIndex } from '../../../src/services/core/RowNames';
import { DEFAULT_SETTINGS } from '../../../src/types';

const read = (lines: string[]) => FileParsePipeline.parse('n.md', lines, DEFAULT_SETTINGS, namesOutsideIndex('n.md'));
const task = (lines: string[]) => read(lines).tasks[0];

/** A note's properties as the index reads them, across the layers. */
describe('property values in a note', () => {
    it('reads a line\'s true as a boolean, as the frontmatter does (論点14a)', () => {
        expect(task(['- [ ] t', '    - f:: true']).properties!.f).toEqual({ type: 'boolean', value: 'true', boolean: true });
        expect(task(['- [ ] t', '    - f:: True']).properties!.f).toEqual({ type: 'boolean', value: 'True', boolean: true });
        expect(task(['- [ ] t', '    - f:: yes']).properties!.f.type).toBe('string');
    });

    it('ignores a note only for tv-ignore\'s YAML boolean true', () => {
        for (const v of ['true', 'True', 'TRUE']) {
            expect(read(['---', `tv-ignore: ${v}`, '---', '- [ ] t']).ignored, v).toBe(true);
        }
        for (const v of ['yes', 'on', '1', '"true"', 'false', 'tRue']) {
            expect(read(['---', `tv-ignore: ${v}`, '---', '- [ ] t']).ignored, v).toBe(false);
        }
    });

    it('reads tv-ignore line by line in a block YAML refuses, by the same spellings', () => {
        expect(read(['---', 'tv-ignore: TRUE # keep out', 'bad: [', '---', '- [ ] t']).ignored).toBe(true);
        expect(read(['---', 'tv-ignore: yes', 'bad: [', '---', '- [ ] t']).ignored).toBe(false);
        expect(read(['---', 'tv-ignore: "true"', 'bad: [', '---', '- [ ] t']).ignored).toBe(false);
    });

    it('reads a property line and a properties group under any list bullet (論点14b)', () => {
        expect(task(['- [ ] t', '    * f:: x']).properties).toEqual({ f: { type: 'string', value: 'x' } });
        expect(task(['- [ ] t', '    1. f:: x']).properties).toEqual({ f: { type: 'string', value: 'x' } });
        expect(task(['* tv-color:: red', '- [ ] t']).cascadeContext?.color).toBe('red');
        expect(task(['+ properties::', '    - tv-color:: red', '- [ ] t']).cascadeContext?.color).toBe('red');
    });

    it('reads a built-in the same way on every layer: the frontmatter\'s number color as its text', () => {
        expect(task(['---', 'tv-color: 336699', '---', '- [ ] t']).cascadeContext?.color).toBe('336699');
        expect(task(['- [ ] t', '    - tv-color:: 336699']).color).toBe('336699');
    });

    it('reads a list of tags as its items, and a text as #tags or a , list', () => {
        expect(task(['- [ ] t', '    - tags:: #a, #b']).tags).toEqual(['a', 'b']);
        expect(task(['- [ ] t', '    - tags:: [a, b]']).tags).toEqual(['a', 'b']);
        expect(task(['- [ ] t', '    - tags:: #a #b']).tags).toEqual(['a', 'b']);
        expect(task(['---', 'tags: [x, y]', '---', '- [ ] t']).cascadeContext?.tags).toEqual(['x', 'y']);
        expect(task(['---', 'tags: "#a #b"', '---', '- [ ] t']).cascadeContext?.tags).toEqual(['a', 'b']);
    });
});
