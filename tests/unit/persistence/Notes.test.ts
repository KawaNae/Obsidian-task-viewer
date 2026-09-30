import { describe, it, expect } from 'vitest';
import { TFile } from 'obsidian';
import { createNote, putBlock, putInNote } from '../../../src/services/persistence/Notes';
import { writeBench, FILE } from '../helpers/writeBench';
import { draftOver } from '../../../src/services/persistence/FileLines';
import type { Section } from '../../../src/services/persistence/Destination';
import { Block, Placement, type SectionSide } from '../../../src/services/persistence/utils/Placement';

/** The section of the heading `heading`, made at `level`, at `side` (the head unless said). */
const section = (heading: string, level = 2, side: SectionSide = 'head'): Section => ({ heading, level, side });

/**
 * putInNote puts a block in a section of a note there through vault.process,
 * and answers the line it went to; a note not there without `create` is
 * refused as gone. What goes where is putBlock's, pinned below.
 */
function harness(initial: string) {
    let content = initial;
    const file = new TFile();
    const app = {
        vault: {
            getAbstractFileByPath: (path: string) => (path === 'note.md' ? file : null),
            process: async (_f: TFile, fn: (data: string) => string) => { content = fn(content); },
        },
    } as any;
    return { app, text: () => content };
}

const put = (app: any, path: string, line: string, to: Section) =>
    putInNote(app, path, undefined, { where: to, block: Block.line(line) });

/**
 * putBlock reads and writes lines (the file's terminator is the write's).
 * What these cases look at is which line goes where, so they stay written as
 * text and meet the lines here.
 */
function insertFromText(content: string, line: string, header: string, headerLevel: number, side: SectionSide = 'head') {
    const { draft } = draftOver(content.split('\n'));
    const at = putBlock(draft, section(header, headerLevel, side), Block.line(line));
    if (typeof at !== 'number') throw new Error(`${at.count} headings`);
    return { content: draft.lines.join('\n'), insertedLine: at };
}

describe('Notes: a line put in a section', () => {
    describe('putInNote', () => {
        it('writes the draft back through vault.process and answers the line', async () => {
            const h = harness('some text\n## Tasks\n- [ ] existing line');
            const at = await put(h.app, 'note.md', '- [ ] new task', section('Tasks'));
            expect(at.written && at.line).toBe(2);
            expect(h.text().split('\n')[2]).toBe('- [ ] new task');
        });

        it('creates the heading when absent, as putBlock does', async () => {
            const h = harness('some text');
            const at = await put(h.app, 'note.md', '- [ ] task', section('Tasks'));
            const lines = h.text().split('\n');
            expect(lines).toContain('## Tasks');
            if (!at.written) throw new Error('expected the write to be made');
            expect(lines[at.line]).toBe('- [ ] task');
        });

        it('is refused as gone without writing when the file does not exist and nothing says what to make', async () => {
            const h = harness('unchanged');
            const at = await put(h.app, 'missing.md', '- [ ] task', section('Tasks'));
            expect(at.written).toBe(false);
            expect(at.refused?.reason).toEqual({ kind: 'gone' });
            expect(h.text()).toBe('unchanged');
        });

        it('is refused, told by the heading and how many there are, when the note has more than one by the name', async () => {
            const h = harness('## Tasks\n- [ ] a\n### tasks\n- [ ] b');
            const at = await put(h.app, 'note.md', '- [ ] n', section('Tasks'));
            expect(at.written).toBe(false);
            expect(at.refused?.reason).toEqual({ kind: 'headings', name: 'Tasks', count: 2 });
            expect(h.text()).toBe('## Tasks\n- [ ] a\n### tasks\n- [ ] b');
        });
    });

    describe('putBlock in a section', () => {
        it('inserts under existing heading', () => {
            const content = 'some text\n## Tasks\n- [ ] existing line';
            const result = insertFromText(content, '- [ ] new task', 'Tasks', 2);
            const lines = result.content.split('\n');
            expect(lines[0]).toBe('some text');
            expect(lines[1]).toBe('## Tasks');
            expect(lines[2]).toBe('- [ ] new task');
            expect(lines[3]).toBe('- [ ] existing line');
            expect(result.insertedLine).toBe(2);
        });

        it('goes past the paragraph under the heading, which a line put above it would take in (P1)', () => {
            const content = '## Tasks\npara one\npara two\n\n- [ ] a';
            const result = insertFromText(content, '- [ ] new', 'Tasks', 2);
            expect(result.content.split('\n')).toEqual(['## Tasks', 'para one', 'para two', '- [ ] new', '', '- [ ] a']);
            expect(result.insertedLine).toBe(3);
        });

        it('puts the line at the indentation of the first item under the heading, as its sibling (P1)', () => {
            const content = '## Tasks\n\n  - [ ] a\n\t- [ ] b';
            const result = insertFromText(content, '- [ ] new', 'Tasks', 2);
            expect(result.content.split('\n')).toEqual(['## Tasks', '  - [ ] new', '', '  - [ ] a', '\t- [ ] b']);
        });

        it('creates heading at EOF when not found', () => {
            const content = 'some text';
            const result = insertFromText(content, '- [ ] new task', 'Tasks', 2);
            const lines = result.content.split('\n');
            expect(lines).toContain('## Tasks');
            expect(lines).toContain('- [ ] new task');
        });

        it('adds empty line before new heading if content does not end with blank', () => {
            const content = 'some text';
            const result = insertFromText(content, '- [ ] task', 'Tasks', 2);
            const lines = result.content.split('\n');
            // Should have empty line between content and new heading
            expect(lines[1]).toBe('');
            expect(lines[2]).toBe('## Tasks');
            expect(result.insertedLine).toBe(3);
        });

        it('does not add extra blank line if content already ends with blank', () => {
            const content = 'some text\n';
            const result = insertFromText(content, '- [ ] task', 'Tasks', 2);
            const lines = result.content.split('\n');
            // Last line of original is empty, so no extra blank line
            expect(lines.filter(l => l === '## Tasks').length).toBe(1);
        });

        it('handles level 1 heading', () => {
            const content = '# MyHeader\n- [ ] text';
            const result = insertFromText(content, 'inserted', 'MyHeader', 1);
            const lines = result.content.split('\n');
            expect(lines[1]).toBe('inserted');
            expect(result.insertedLine).toBe(1);
        });

        it('handles level 3 heading', () => {
            const content = '### Deep\n- [ ] text';
            const result = insertFromText(content, 'inserted', 'Deep', 3);
            const lines = result.content.split('\n');
            expect(lines[1]).toBe('inserted');
            expect(result.insertedLine).toBe(1);
        });

        it('handles empty file', () => {
            const result = insertFromText('', '- [ ] task', 'Tasks', 2);
            expect(result.content).toContain('## Tasks');
            expect(result.content).toContain('- [ ] task');
            expect(result.insertedLine).toBe(1);
        });

        it('matches heading exactly (not partial)', () => {
            const content = '## TasksExtra\n## Tasks\n- [ ] under';
            const result = insertFromText(content, 'new', 'Tasks', 2);
            const lines = result.content.split('\n');
            // Should insert under "## Tasks" not "## TasksExtra"
            expect(lines[2]).toBe('new');
            expect(result.insertedLine).toBe(2);
        });

        it('puts nothing when two headings go by the name, whatever their levels and case', () => {
            for (const content of ['## Tasks\n- [ ] first\n## Tasks\nsecond', '## Tasks\n### TASKS']) {
                const { draft } = draftOver(content.split('\n'));
                expect(putBlock(draft, section('Tasks'), Block.line('inserted'))).toEqual({ kind: 'many', count: 2 });
                expect(draft.lines.join('\n')).toBe(content);
            }
        });

        it('ignores heading inside code fence and matches real one after it', () => {
            const content = '```\n## Tasks\n```\n## Tasks\n- [ ] under';
            const result = insertFromText(content, 'inserted', 'Tasks', 2);
            const lines = result.content.split('\n');
            expect(lines[3]).toBe('## Tasks');
            expect(lines[4]).toBe('inserted');
            expect(lines[5]).toBe('- [ ] under');
            expect(result.insertedLine).toBe(4);
        });

        it('creates heading at EOF when the only match is fenced', () => {
            const content = '```\n## Tasks\n```';
            const result = insertFromText(content, '- [ ] task', 'Tasks', 2);
            const lines = result.content.split('\n');
            // fenced occurrence untouched, new heading appended at end
            expect(lines[1]).toBe('## Tasks');
            expect(lines[lines.length - 2]).toBe('## Tasks');
            expect(lines[lines.length - 1]).toBe('- [ ] task');
        });

        it('ignores heading inside tilde fence', () => {
            const content = '~~~\n## Tasks\n~~~\n## Tasks\n- [ ] under';
            const result = insertFromText(content, 'inserted', 'Tasks', 2);
            const lines = result.content.split('\n');
            expect(lines[4]).toBe('inserted');
            expect(result.insertedLine).toBe(4);
        });

        it('does not close a longer fence with a shorter delimiter', () => {
            const content = '````\n```\n## Tasks\n````\n## Tasks\n- [ ] under';
            const result = insertFromText(content, 'inserted', 'Tasks', 2);
            const lines = result.content.split('\n');
            expect(lines[4]).toBe('## Tasks');
            expect(lines[5]).toBe('inserted');
            expect(result.insertedLine).toBe(5);
        });

        it('does not take a heading-like line inside the frontmatter for the heading', () => {
            const content = '---\n## Tasks\na: 1\n---\nbody';
            const result = insertFromText(content, '- [ ] task', 'Tasks', 2);
            const lines = result.content.split('\n');
            expect(lines.slice(0, 4)).toEqual(['---', '## Tasks', 'a: 1', '---']);
            expect(lines[result.insertedLine]).toBe('- [ ] task');
            expect(lines[result.insertedLine - 1]).toBe('## Tasks');
            expect(result.insertedLine).toBeGreaterThan(4);
        });

        it('reads the heading as the note does: a setext one, one indented up to three columns, one closed with `#` (F8)', () => {
            const put = (lines: string[]) => insertFromText(lines.join('\n'), '- [ ] n', 'Tasks', 2).content.split('\n');
            expect(put(['Tasks', '---', '- [ ] a'])).toEqual(['Tasks', '---', '- [ ] n', '- [ ] a']);
            expect(put(['text', '', '  ## Tasks', '- [ ] a'])).toEqual(['text', '', '  ## Tasks', '- [ ] n', '- [ ] a']);
            expect(put(['## Tasks ##', '- [ ] a'])).toEqual(['## Tasks ##', '- [ ] n', '- [ ] a']);
        });

        it('takes a heading of any level for the heading, as a link to it does: the level is the one a heading is made at', () => {
            expect(insertFromText(['Tasks', '===', '- [ ] a'].join('\n'), '- [ ] n', 'Tasks', 2).content.split('\n'))
                .toEqual(['Tasks', '===', '- [ ] n', '- [ ] a']);
            expect(insertFromText(['### Tasks', '- [ ] a'].join('\n'), '- [ ] n', 'Tasks', 2).content.split('\n'))
                .toEqual(['### Tasks', '- [ ] n', '- [ ] a']);
            expect(insertFromText(['## **tasks**', '- [ ] a'].join('\n'), '- [ ] n', 'Tasks', 2).content.split('\n'))
                .toEqual(['## **tasks**', '- [ ] n', '- [ ] a']);
        });

        it('makes the heading at the level asked for when the note has none by the name', () => {
            expect(insertFromText('text', '- [ ] n', 'Log', 3).content.split('\n')).toEqual(['text', '', '### Log', '- [ ] n']);
        });

        it('does not take an indented heading-like line for the heading', () => {
            // Indented, it is a line of the task above it, as the parser reads it.
            const content = '- [ ] P\n    ## Tasks\n    - [ ] c\n';
            const result = insertFromText(content, '- [ ] task', 'Tasks', 2);
            const lines = result.content.split('\n');
            expect(lines.slice(0, 3)).toEqual(['- [ ] P', '    ## Tasks', '    - [ ] c']);
            expect(lines[result.insertedLine - 1]).toBe('## Tasks');
        });

        it('puts the line at the end of the section, just above a deeper heading, with the end side', () => {
            const content = ['## Tasks', '- [ ] a', '- [ ] b', '', '### Sub', '- tv-color:: gray', '- [ ] c'].join('\n');
            const result = insertFromText(content, '- [ ] n', 'Tasks', 2, 'end');
            expect(result.content.split('\n')).toEqual(['## Tasks', '- [ ] a', '- [ ] b', '- [ ] n', '', '### Sub', '- tv-color:: gray', '- [ ] c']);
            expect(result.insertedLine).toBe(3);
        });

        it('puts the line past the subtree of the section\'s last item, with the end side', () => {
            const content = ['## Tasks', '- [ ] a', '    - [ ] child', '## Next'].join('\n');
            expect(insertFromText(content, '- [ ] n', 'Tasks', 2, 'end').content.split('\n'))
                .toEqual(['## Tasks', '- [ ] a', '    - [ ] child', '- [ ] n', '## Next']);
        });

        it('makes the heading at the end of the note whichever the side', () => {
            expect(insertFromText('text', '- [ ] n', 'Tasks', 2, 'end').content.split('\n')).toEqual(['text', '', '## Tasks', '- [ ] n']);
        });

        it('frontmatter のみのファイルで heading 作成時の行番号', () => {
            const content = '---\ntv-color: fff\n---';
            const result = insertFromText(content, '- [ ] task', 'Tasks', 2);
            const lines = result.content.split('\n');
            expect(lines[lines.length - 1]).toBe('- [ ] task');
            expect(lines[lines.length - 2]).toBe('## Tasks');
            expect(result.insertedLine).toBe(lines.length - 1);
        });
    });
});

describe('Notes: a note made with lines put in it', () => {
    const NEW = '2026-10-01.md';
    const LOG: Section = { heading: 'Log', level: 2, side: 'end' };

    /** A bench whose `vault.create` answers a turn later and, as Obsidian's does, throws for a path taken. */
    async function benchLikeObsidian() {
        const b = await writeBench({ [FILE]: '# note' });
        const create = b.app.vault.create;
        b.app.vault.create = async (path: string, data: string) => {
            await Promise.resolve();
            if (b.contents.has(path)) throw new Error('File already exists.');
            return create(path, data);
        };
        return b;
    }

    it('writes the seed with the block in it, in one create, the seed\'s terminator and mark kept', async () => {
        const b = await writeBench({ [FILE]: '# note' });
        const created: string[] = [];
        const create = b.app.vault.create;
        b.app.vault.create = async (path: string, data: string) => { created.push(data); return create(path, data); };

        const at = await putInNote(b.app, NEW, b.channel(NEW), {
            where: LOG, block: Block.line('- [ ] a'), create: () => '﻿# 2026-10-01\r\n\r\n## Log\r\n',
        });

        expect(at.written && at.line).toBe(3);
        expect(created).toEqual(['﻿# 2026-10-01\r\n\r\n## Log\r\n- [ ] a\r\n']);
        expect(b.refused).toEqual([]);
    });

    it('two blocks put in a note not there yet: the first makes it, the second is put in the note it made, neither refused', async () => {
        const b = await benchLikeObsidian();
        const template = () => '# 2026-10-01\n';

        const [first, second] = await Promise.all([
            putInNote(b.app, NEW, b.channel(NEW), { where: LOG, block: Block.line('- [x] first'), create: template }),
            putInNote(b.app, NEW, b.channel(NEW), { where: LOG, block: Block.line('- [x] second'), create: template }),
        ]);

        expect(first.written).toBe(true);
        expect(second.written).toBe(true);
        expect(b.refused).toEqual([]);
        // As two blocks put in turn in a note that was there: the section's end side puts the second below.
        expect(b.text(NEW)).toBe('# 2026-10-01\n\n## Log\n- [x] first\n- [x] second\n');
    });

    it('a seed that could not be made fails the write, told once, and nothing created', async () => {
        const b = await writeBench({ [FILE]: '# note' });

        const at = await putInNote(b.app, NEW, b.channel(NEW), {
            where: 'end', block: Block.line('- [ ] a'), create: async () => { throw new Error('template unreadable'); },
        });

        expect(at.refused?.reason).toEqual({ kind: 'failed' });
        expect(b.refused).toHaveLength(1);
        expect(b.contents.has(NEW)).toBe(false);
    });

    it('createNote makes the note of the seed as it is without an edit, and of the edit\'s lines with one', async () => {
        const b = await writeBench({ [FILE]: '# note' });

        expect((await createNote(b.app, 'a.md', b.channel('a.md'), 'a', () => ''))).toMatchObject({ written: true });
        expect((await createNote(b.app, 'b.md', b.channel('b.md'), 'b', () => '', (draft) => {
            draft.put(Placement.end(draft.reading()), Block.line('- [ ] b'));
            return true;
        }))).toMatchObject({ written: true });

        expect(b.text('a.md')).toBe('');
        expect(b.text('b.md')).toBe('- [ ] b\n');
    });
});
