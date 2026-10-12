import { describe, it, expect } from 'vitest';
import { hubFindings, lockedFields } from '../../../src/modals/hub/HubFindings';
import { FileParsePipeline } from '../../../src/services/parsing/FileParsePipeline';
import { namesOutsideIndex } from '../../../src/services/core/RowNames';
import { DEFAULT_SCOPE_KEYS, DEFAULT_SETTINGS } from '../../../src/types';

/**
 * The row's own findings, by the hub's field each is of: a property's block
 * locks that property's field, and a date key under the task is the form's
 * and locks none. The sentence is the editor's.
 */

const taskOf = (lines: string[]) => FileParsePipeline.parse('n.md', lines, DEFAULT_SETTINGS, namesOutsideIndex('n.md')).tasks[0];
const brief = (lines: string[]) => hubFindings(taskOf(lines), DEFAULT_SCOPE_KEYS).map(f => [f.field, f.tone, f.key, f.line]);

describe('hubFindings', () => {
    it('puts a style key\'s finding on its field, whatever the key\'s case', () => {
        expect(brief(['# h', '- [ ] t', '    - TV-COLOR:: rde'])).toEqual([['color', 'warning', 'TV-COLOR', 2]]);
        expect(brief(['- [ ] t', '    - tv-linestyle:: wavy'])).toEqual([['linestyle', 'warning', 'tv-linestyle', 1]]);
        expect(brief(['- [ ] t', '    - tv-mask:: a', '    - tv-mask:: b'])).toEqual([['mask', 'error', 'tv-mask', 1], ['mask', 'error', 'tv-mask', 2]]);
    });

    it('puts the tags\' finding on the tags field', () => {
        expect(brief(['- [ ] t', '    - tags::', '        - a:: b'])).toEqual([['tags', 'warning', 'tags', 2]]);
    });

    it('puts a custom property\'s finding on its row, by its key folded', () => {
        expect(brief(['- [ ] t', '    - Area:: lab', '      text'])).toEqual([['prop:area', 'warning', 'Area', 2]]);
        expect(brief(['- [ ] t', '    - a:: 1', '    - A:: 2'])).toEqual([['prop:a', 'error', 'a', 1], ['prop:a', 'error', 'A', 2]]);
    });

    it('says a date key under the task of the form, and locks nothing by it', () => {
        const findings = hubFindings(taskOf(['- [ ] t', '    - tv-start:: 2026-01-01', '    - x:: 1', '      y']), DEFAULT_SCOPE_KEYS);
        expect(findings.map(f => f.field)).toEqual(['form', 'prop:x']);
        expect([...lockedFields(findings)]).toEqual(['prop:x']);
    });

    it('says the editor\'s sentence for the finding\'s line', () => {
        const [finding] = hubFindings(taskOf(['- [ ] t', '    - author::', '        - name:: Kawa']), DEFAULT_SCOPE_KEYS);
        expect(finding.text).toContain('name:: Kawa');
        expect(finding.text).toContain('author');
    });

    it('has none for a row whose lines are well written', () => {
        expect(hubFindings(taskOf(['- [ ] t', '    - area:: lab']), DEFAULT_SCOPE_KEYS)).toEqual([]);
    });
});
