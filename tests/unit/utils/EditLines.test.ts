import { describe, it, expect } from 'vitest';
import { editLines } from '../../../src/utils/FileLines';
import type { NamedRow } from '../../../src/utils/FileLines';
import { Block } from '../../../src/services/persistence/utils/Placement';

/**
 * The core every write of lines runs, with nothing written anywhere: what
 * `processLines` writes to the file, and what the editor's write is made of.
 */
describe('editLines', () => {
    const note = ['# Note', '- [ ] a', '- [ ] b'];

    it('answers the lines the write left and its report, and leaves the lines handed in alone', () => {
        const handed = [...note];
        const edited = editLines('n.md', handed, '\n', (draft, _eol, session) => {
            const at = session.row({ line: 1, text: '- [ ] a' });
            if (at === null) return false;
            draft.rewrite(at, '- [x] a');
            draft.put({ at: at + 1, parent: null, indent: '' }, Block.read(['- [ ] a next']));
            return true;
        });
        expect(handed).toEqual(note);
        expect(edited.written).toBe(true);
        if (!edited.written) return;
        expect(edited.before).toEqual(note);
        expect(edited.lines).toEqual(['# Note', '- [x] a', '- [ ] a next', '- [ ] b']);
        expect(edited.edits).toEqual([{ kind: 'replaced', at: 1 }, { kind: 'inserted', at: 2, count: 1 }]);
    });

    it('refuses a line the editor showed otherwise, by the editor\'s text', () => {
        const edited = editLines('n.md', note, '\n', (draft, _eol, session) => {
            const at = session.row({ line: 1, text: '  - [ ] b  ' });
            if (at === null) return false;
            draft.rewrite(at, '- [x] b');
            return true;
        });
        expect(edited).toEqual({ written: false, refused: { file: 'n.md', reason: { kind: 'changed' }, subject: '- [ ] b' } });
    });

    it('finds no named row with nobody to ask, and tells whoever listens what it asked for', () => {
        const asked: string[] = [];
        const row: NamedRow = { line: 2, subject: 'a', basis: { text: '- [ ] a' } };
        const edited = editLines('n.md', note, '\n', (_draft, _eol, session) => session.row(row) !== null, {
            asked: (subject) => asked.push(subject),
        });
        expect(edited).toEqual({ written: false, refused: { file: 'n.md', reason: { kind: 'changed' }, subject: 'a' } });
        expect(asked).toEqual(['a']);
    });

    it('refuses a write that would change what another line is', () => {
        const edited = editLines('n.md', ['- [ ] a', '    - [ ] child'], '\n', (draft, _eol, session) => {
            const at = session.row({ line: 0, text: '- [ ] a' });
            if (at === null) return false;
            draft.rewrite(at, 'a');
            return true;
        }, { about: 'the task' });
        expect(edited).toEqual({ written: false, refused: { file: 'n.md', reason: { kind: 'disturbs' }, subject: '- [ ] a' } });
    });
});
