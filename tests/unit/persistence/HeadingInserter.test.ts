import { describe, it, expect } from 'vitest';
import { HeadingInserter } from '../../../src/utils/HeadingInserter';

describe('HeadingInserter', () => {
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
