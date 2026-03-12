import { describe, it, expect } from 'vitest';
import { HeadingInserter } from '../../src/utils/HeadingInserter';

describe('HeadingInserter', () => {
    describe('insertUnderHeading', () => {
        it('inserts under existing heading', () => {
            const content = 'some text\n## Tasks\nexisting line';
            const result = HeadingInserter.insertUnderHeading(content, '- [ ] new task', 'Tasks', 2);
            const lines = result.split('\n');
            expect(lines[0]).toBe('some text');
            expect(lines[1]).toBe('## Tasks');
            expect(lines[2]).toBe('- [ ] new task');
            expect(lines[3]).toBe('existing line');
        });

        it('creates heading at EOF when not found', () => {
            const content = 'some text';
            const result = HeadingInserter.insertUnderHeading(content, '- [ ] new task', 'Tasks', 2);
            const lines = result.split('\n');
            expect(lines).toContain('## Tasks');
            expect(lines).toContain('- [ ] new task');
        });

        it('adds empty line before new heading if content does not end with blank', () => {
            const content = 'some text';
            const result = HeadingInserter.insertUnderHeading(content, '- [ ] task', 'Tasks', 2);
            const lines = result.split('\n');
            // Should have empty line between content and new heading
            expect(lines[1]).toBe('');
            expect(lines[2]).toBe('## Tasks');
        });

        it('does not add extra blank line if content already ends with blank', () => {
            const content = 'some text\n';
            const result = HeadingInserter.insertUnderHeading(content, '- [ ] task', 'Tasks', 2);
            const lines = result.split('\n');
            // Last line of original is empty, so no extra blank line
            expect(lines.filter(l => l === '## Tasks').length).toBe(1);
        });

        it('handles level 1 heading', () => {
            const content = '# MyHeader\ntext';
            const result = HeadingInserter.insertUnderHeading(content, 'inserted', 'MyHeader', 1);
            const lines = result.split('\n');
            expect(lines[1]).toBe('inserted');
        });

        it('handles level 3 heading', () => {
            const content = '### Deep\ntext';
            const result = HeadingInserter.insertUnderHeading(content, 'inserted', 'Deep', 3);
            const lines = result.split('\n');
            expect(lines[1]).toBe('inserted');
        });

        it('handles empty file', () => {
            const result = HeadingInserter.insertUnderHeading('', '- [ ] task', 'Tasks', 2);
            expect(result).toContain('## Tasks');
            expect(result).toContain('- [ ] task');
        });

        it('matches heading exactly (not partial)', () => {
            const content = '## TasksExtra\n## Tasks\nunder';
            const result = HeadingInserter.insertUnderHeading(content, 'new', 'Tasks', 2);
            const lines = result.split('\n');
            // Should insert under "## Tasks" not "## TasksExtra"
            expect(lines[2]).toBe('new');
        });

        it('inserts at first match when multiple same headings', () => {
            const content = '## Tasks\nfirst\n## Tasks\nsecond';
            const result = HeadingInserter.insertUnderHeading(content, 'inserted', 'Tasks', 2);
            const lines = result.split('\n');
            expect(lines[0]).toBe('## Tasks');
            expect(lines[1]).toBe('inserted');
            expect(lines[2]).toBe('first');
        });
    });
});
