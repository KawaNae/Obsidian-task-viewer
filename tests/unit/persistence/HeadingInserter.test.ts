import { describe, it, expect } from 'vitest';
import { TFile } from 'obsidian';
import { HeadingInserter } from '../../../src/utils/HeadingInserter';

/**
 * writeUnderHeading は TaskIndex.createTask / DailyNoteUtils.appendLineToDailyNote /
 * FrontmatterWriter.insertLineUnderHeading の 3 重実装を一本化した先。この
 * ラッパー自体は「insertUnderHeading の結果を vault.process で書き戻し、
 * insertedLine を返す」だけなので、pin するのは vault.process への配線と
 * ファイル不在時の -1 フォールバックの 2 点。
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

describe('HeadingInserter', () => {
    describe('writeUnderHeading', () => {
        it('writes the pure-function result back through vault.process and returns insertedLine', async () => {
            const h = harness('some text\n## Tasks\nexisting line');
            const insertedLine = await HeadingInserter.writeUnderHeading(
                h.app, 'note.md', '- [ ] new task', 'Tasks', 2
            );
            expect(insertedLine).toBe(2);
            expect(h.text().split('\n')[2]).toBe('- [ ] new task');
        });

        it('creates the heading when absent, matching insertUnderHeading', async () => {
            const h = harness('some text');
            const insertedLine = await HeadingInserter.writeUnderHeading(
                h.app, 'note.md', '- [ ] task', 'Tasks', 2
            );
            const lines = h.text().split('\n');
            expect(lines).toContain('## Tasks');
            expect(lines[insertedLine]).toBe('- [ ] task');
        });

        it('returns -1 without writing when the file does not exist', async () => {
            const h = harness('unchanged');
            const insertedLine = await HeadingInserter.writeUnderHeading(
                h.app, 'missing.md', '- [ ] task', 'Tasks', 2
            );
            expect(insertedLine).toBe(-1);
            expect(h.text()).toBe('unchanged');
        });

        it('writes via a directly-passed TFile even when getAbstractFileByPath cannot resolve it yet', async () => {
            // DailyNoteUtils.appendLineToDailyNote が createDailyNote 直後の
            // TFile を渡す経路の pin。作成直後は vault index からパスで
            // 引き直せるとは限らないため、TFile を経由しない配線が必須。
            let content = '## Tasks\nexisting';
            const file = new TFile();
            const app = {
                vault: {
                    getAbstractFileByPath: () => null, // 意図的に解決できない状態を模す
                    process: async (_f: TFile, fn: (data: string) => string) => { content = fn(content); },
                },
            } as any;

            const insertedLine = await HeadingInserter.writeUnderHeading(
                app, file, '- [ ] just created', 'Tasks', 2
            );
            expect(insertedLine).toBe(1);
            expect(content.split('\n')[1]).toBe('- [ ] just created');
        });
    });

    describe('insertUnderHeading', () => {
        it('inserts under existing heading', () => {
            const content = 'some text\n## Tasks\nexisting line';
            const result = HeadingInserter.insertUnderHeading(content, '- [ ] new task', 'Tasks', 2);
            const lines = result.content.split('\n');
            expect(lines[0]).toBe('some text');
            expect(lines[1]).toBe('## Tasks');
            expect(lines[2]).toBe('- [ ] new task');
            expect(lines[3]).toBe('existing line');
            expect(result.insertedLine).toBe(2);
        });

        it('creates heading at EOF when not found', () => {
            const content = 'some text';
            const result = HeadingInserter.insertUnderHeading(content, '- [ ] new task', 'Tasks', 2);
            const lines = result.content.split('\n');
            expect(lines).toContain('## Tasks');
            expect(lines).toContain('- [ ] new task');
        });

        it('adds empty line before new heading if content does not end with blank', () => {
            const content = 'some text';
            const result = HeadingInserter.insertUnderHeading(content, '- [ ] task', 'Tasks', 2);
            const lines = result.content.split('\n');
            // Should have empty line between content and new heading
            expect(lines[1]).toBe('');
            expect(lines[2]).toBe('## Tasks');
            expect(result.insertedLine).toBe(3);
        });

        it('does not add extra blank line if content already ends with blank', () => {
            const content = 'some text\n';
            const result = HeadingInserter.insertUnderHeading(content, '- [ ] task', 'Tasks', 2);
            const lines = result.content.split('\n');
            // Last line of original is empty, so no extra blank line
            expect(lines.filter(l => l === '## Tasks').length).toBe(1);
        });

        it('handles level 1 heading', () => {
            const content = '# MyHeader\ntext';
            const result = HeadingInserter.insertUnderHeading(content, 'inserted', 'MyHeader', 1);
            const lines = result.content.split('\n');
            expect(lines[1]).toBe('inserted');
            expect(result.insertedLine).toBe(1);
        });

        it('handles level 3 heading', () => {
            const content = '### Deep\ntext';
            const result = HeadingInserter.insertUnderHeading(content, 'inserted', 'Deep', 3);
            const lines = result.content.split('\n');
            expect(lines[1]).toBe('inserted');
            expect(result.insertedLine).toBe(1);
        });

        it('handles empty file', () => {
            const result = HeadingInserter.insertUnderHeading('', '- [ ] task', 'Tasks', 2);
            expect(result.content).toContain('## Tasks');
            expect(result.content).toContain('- [ ] task');
            expect(result.insertedLine).toBe(2);
        });

        it('matches heading exactly (not partial)', () => {
            const content = '## TasksExtra\n## Tasks\nunder';
            const result = HeadingInserter.insertUnderHeading(content, 'new', 'Tasks', 2);
            const lines = result.content.split('\n');
            // Should insert under "## Tasks" not "## TasksExtra"
            expect(lines[2]).toBe('new');
            expect(result.insertedLine).toBe(2);
        });

        it('inserts at first match when multiple same headings', () => {
            const content = '## Tasks\nfirst\n## Tasks\nsecond';
            const result = HeadingInserter.insertUnderHeading(content, 'inserted', 'Tasks', 2);
            const lines = result.content.split('\n');
            expect(lines[0]).toBe('## Tasks');
            expect(lines[1]).toBe('inserted');
            expect(lines[2]).toBe('first');
            expect(result.insertedLine).toBe(1);
        });

        it('ignores heading inside code fence and matches real one after it', () => {
            const content = '```\n## Tasks\n```\n## Tasks\nunder';
            const result = HeadingInserter.insertUnderHeading(content, 'inserted', 'Tasks', 2);
            const lines = result.content.split('\n');
            expect(lines[3]).toBe('## Tasks');
            expect(lines[4]).toBe('inserted');
            expect(lines[5]).toBe('under');
            expect(result.insertedLine).toBe(4);
        });

        it('creates heading at EOF when the only match is fenced', () => {
            const content = '```\n## Tasks\n```';
            const result = HeadingInserter.insertUnderHeading(content, '- [ ] task', 'Tasks', 2);
            const lines = result.content.split('\n');
            // fenced occurrence untouched, new heading appended at end
            expect(lines[1]).toBe('## Tasks');
            expect(lines[lines.length - 2]).toBe('## Tasks');
            expect(lines[lines.length - 1]).toBe('- [ ] task');
        });

        it('ignores heading inside tilde fence', () => {
            const content = '~~~\n## Tasks\n~~~\n## Tasks\nunder';
            const result = HeadingInserter.insertUnderHeading(content, 'inserted', 'Tasks', 2);
            const lines = result.content.split('\n');
            expect(lines[4]).toBe('inserted');
            expect(result.insertedLine).toBe(4);
        });

        it('does not close a longer fence with a shorter delimiter', () => {
            const content = '````\n```\n## Tasks\n````\n## Tasks\nunder';
            const result = HeadingInserter.insertUnderHeading(content, 'inserted', 'Tasks', 2);
            const lines = result.content.split('\n');
            expect(lines[4]).toBe('## Tasks');
            expect(lines[5]).toBe('inserted');
            expect(result.insertedLine).toBe(5);
        });

        it('frontmatter のみのファイルで heading 作成時の行番号', () => {
            const content = '---\ntv-color: fff\n---';
            const result = HeadingInserter.insertUnderHeading(content, '- [ ] task', 'Tasks', 2);
            const lines = result.content.split('\n');
            expect(lines[lines.length - 1]).toBe('- [ ] task');
            expect(lines[lines.length - 2]).toBe('## Tasks');
            expect(result.insertedLine).toBe(lines.length - 1);
        });
    });
});
