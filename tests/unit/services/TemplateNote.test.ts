import { describe, it, expect } from 'vitest';
import { templateNoteContent, templateNotePath, yamlQuoted } from '../../../src/services/template/TemplateNote';

describe('TemplateNote', () => {
    it('names the note after the template, with the characters a file name cannot hold made _', () => {
        expect(templateNotePath('Templates/Views', 'a/b:c?')).toBe('Templates/Views/a_b_c_.md');
    });

    it('writes the frontmatter fields and the data as a JSON block', () => {
        expect(templateNoteContent([['_tv-view', 'timeline'], ['_tv-name', yamlQuoted('say "hi" \\ bye')]], { a: 1 }))
            .toBe('---\n_tv-view: timeline\n_tv-name: "say \\"hi\\" \\\\ bye"\n---\n\n```json\n{\n  "a": 1\n}\n```\n');
    });

    it('writes no JSON block for no data', () => {
        expect(templateNoteContent([['_tv-name', '"x"']], null)).toBe('---\n_tv-name: "x"\n---\n');
    });
});
