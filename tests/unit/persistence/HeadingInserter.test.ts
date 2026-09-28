import { describe, it, expect } from 'vitest';
import { TFile } from 'obsidian';
import { HeadingInserter } from '../../../src/utils/HeadingInserter';
import { draftOver } from '../../../src/services/persistence/FileLines';
import type { Section } from '../../../src/services/persistence/Destination';
import type { SectionSide } from '../../../src/services/persistence/utils/Placement';

/** The section of the heading `heading`, made at `level`, at `side` (the head unless said). */
const section = (heading: string, level = 2, side: SectionSide = 'head'): Section => ({ heading, level, side });

/**
 * writeUnderHeading は TaskIndex.createTask / DailyNoteUtils.appendLineToDailyNote /
 * FrontmatterWriter.insertLineUnderHeading の 3 重実装を一本化した先。この
 * ラッパー自体は「insertUnderHeading の結果を vault.process で書き戻し、
 * insertedLine を返す」だけなので、pin するのは vault.process への配線と
 * ファイル不在時の拒否（gone）の 2 点。
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

/**
 * insertUnderHeading は行配列で読み書きする（ファイルの改行を呼び口が持つ）。
 * これらのケースが見ているのは「どの行がどこに入るか」なので、文字列で書いた
 * 元のままにしておき、境界だけここで合わせる。
 */
function insertFromText(content: string, line: string, header: string, headerLevel: number, side: SectionSide = 'head') {
    const { draft } = draftOver(content.split('\n'));
    const put = HeadingInserter.insertUnderHeading(draft, line, section(header, headerLevel, side));
    if (typeof put !== 'number') throw new Error(`${put.count} headings`);
    return { content: draft.lines.join('\n'), insertedLine: put };
}

describe('HeadingInserter', () => {
    describe('writeUnderHeading', () => {
        it('writes the pure-function result back through vault.process and returns insertedLine', async () => {
            const h = harness('some text\n## Tasks\n- [ ] existing line');
            const at = await HeadingInserter.writeUnderHeading(
                h.app, 'note.md', undefined, '- [ ] new task', section('Tasks')
            );
            expect(at.written && at.line).toBe(2);
            expect(h.text().split('\n')[2]).toBe('- [ ] new task');
        });

        it('creates the heading when absent, matching insertUnderHeading', async () => {
            const h = harness('some text');
            const at = await HeadingInserter.writeUnderHeading(
                h.app, 'note.md', undefined, '- [ ] task', section('Tasks')
            );
            const lines = h.text().split('\n');
            expect(lines).toContain('## Tasks');
            if (!at.written) throw new Error('expected the write to be made');
            expect(lines[at.line]).toBe('- [ ] task');
        });

        it('is refused as gone without writing when the file does not exist', async () => {
            const h = harness('unchanged');
            const at = await HeadingInserter.writeUnderHeading(
                h.app, 'missing.md', undefined, '- [ ] task', section('Tasks')
            );
            expect(at.written).toBe(false);
            expect(at.refused?.reason).toEqual({ kind: 'gone' });
            expect(h.text()).toBe('unchanged');
        });

        it('is refused, told by the heading and how many there are, when the note has more than one by the name', async () => {
            const h = harness('## Tasks\n- [ ] a\n### tasks\n- [ ] b');
            const at = await HeadingInserter.writeUnderHeading(h.app, 'note.md', undefined, '- [ ] n', section('Tasks'));
            expect(at.written).toBe(false);
            expect(at.refused?.reason).toEqual({ kind: 'headings', name: 'Tasks', count: 2 });
            expect(h.text()).toBe('## Tasks\n- [ ] a\n### tasks\n- [ ] b');
        });

        it('writes via a directly-passed TFile even when getAbstractFileByPath cannot resolve it yet', async () => {
            // DailyNoteUtils.appendLineToDailyNote が createDailyNote 直後の
            // TFile を渡す経路の pin。作成直後は vault index からパスで
            // 引き直せるとは限らないため、TFile を経由しない配線が必須。
            let content = '## Tasks\n- [ ] existing';
            const file = new TFile();
            const app = {
                vault: {
                    getAbstractFileByPath: () => null, // 意図的に解決できない状態を模す
                    process: async (_f: TFile, fn: (data: string) => string) => { content = fn(content); },
                },
            } as any;

            const at = await HeadingInserter.writeUnderHeading(
                app, file, undefined, '- [ ] just created', section('Tasks')
            );
            expect(at.written && at.line).toBe(1);
            expect(content.split('\n')[1]).toBe('- [ ] just created');
        });
    });

    describe('insertUnderHeading', () => {
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
                expect(HeadingInserter.insertUnderHeading(draft, 'inserted', section('Tasks'))).toEqual({ kind: 'many', count: 2 });
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
