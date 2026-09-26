import { describe, it, expect } from 'vitest';
import { TFile } from 'obsidian';
import { HeadingInserter } from '../../../src/utils/HeadingInserter';
import { draftOver } from '../../../src/services/persistence/FileLines';

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
function insertFromText(content: string, line: string, header: string, headerLevel: number) {
    const { draft } = draftOver(content.split('\n'));
    const insertedLine = HeadingInserter.insertUnderHeading(draft, line, header, headerLevel);
    return { content: draft.lines.join('\n'), insertedLine };
}

describe('HeadingInserter', () => {
    describe('writeUnderHeading', () => {
        it('writes the pure-function result back through vault.process and returns insertedLine', async () => {
            const h = harness('some text\n## Tasks\n- [ ] existing line');
            const at = await HeadingInserter.writeUnderHeading(
                h.app, 'note.md', undefined, '- [ ] new task', 'Tasks', 2
            );
            expect(at.written && at.line).toBe(2);
            expect(h.text().split('\n')[2]).toBe('- [ ] new task');
        });

        it('creates the heading when absent, matching insertUnderHeading', async () => {
            const h = harness('some text');
            const at = await HeadingInserter.writeUnderHeading(
                h.app, 'note.md', undefined, '- [ ] task', 'Tasks', 2
            );
            const lines = h.text().split('\n');
            expect(lines).toContain('## Tasks');
            if (!at.written) throw new Error('expected the write to be made');
            expect(lines[at.line]).toBe('- [ ] task');
        });

        it('is refused as gone without writing when the file does not exist', async () => {
            const h = harness('unchanged');
            const at = await HeadingInserter.writeUnderHeading(
                h.app, 'missing.md', undefined, '- [ ] task', 'Tasks', 2
            );
            expect(at.written).toBe(false);
            expect(at.refused?.reason).toEqual({ kind: 'gone' });
            expect(h.text()).toBe('unchanged');
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
                app, file, undefined, '- [ ] just created', 'Tasks', 2
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

        it('inserts at first match when multiple same headings', () => {
            const content = '## Tasks\n- [ ] first\n## Tasks\nsecond';
            const result = insertFromText(content, 'inserted', 'Tasks', 2);
            const lines = result.content.split('\n');
            expect(lines[0]).toBe('## Tasks');
            expect(lines[1]).toBe('inserted');
            expect(lines[2]).toBe('- [ ] first');
            expect(result.insertedLine).toBe(1);
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

        it('does not take a heading of another level for the heading', () => {
            const result = insertFromText(['Tasks', '===', '- [ ] a'].join('\n'), '- [ ] n', 'Tasks', 2);
            expect(result.content.split('\n')).toEqual(['Tasks', '===', '- [ ] a', '', '## Tasks', '- [ ] n']);
        });

        it('does not take an indented heading-like line for the heading', () => {
            // Indented, it is a line of the task above it, as the parser reads it.
            const content = '- [ ] P\n    ## Tasks\n    - [ ] c\n';
            const result = insertFromText(content, '- [ ] task', 'Tasks', 2);
            const lines = result.content.split('\n');
            expect(lines.slice(0, 3)).toEqual(['- [ ] P', '    ## Tasks', '    - [ ] c']);
            expect(lines[result.insertedLine - 1]).toBe('## Tasks');
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
