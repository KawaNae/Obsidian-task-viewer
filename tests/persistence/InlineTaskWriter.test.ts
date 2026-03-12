import { describe, it, expect } from 'vitest';
import { InlineTaskWriter } from '../../src/services/persistence/writers/InlineTaskWriter';
import { FileOperations } from '../../src/services/persistence/utils/FileOperations';
import type { Task } from '../../src/types';
import { createInMemoryVault, createFakeApp } from '../helpers/fakeApp';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<Task> = {}): Task {
    return {
        id: overrides.id ?? 'at-notation:note.md:ln:1',
        file: overrides.file ?? 'note.md',
        line: overrides.line ?? 0,
        content: overrides.content ?? 'Test task',
        statusChar: overrides.statusChar ?? ' ',
        indent: 0,
        childIds: [],
        childLines: [],
        childLineBodyOffsets: [],
        originalText: overrides.originalText ?? '- [ ] Test task @2026-03-11',
        tags: [],
        parserId: 'at-notation',
        ...overrides,
    };
}

function setup(fileContents: Record<string, string>) {
    const vault = createInMemoryVault(fileContents);
    const app = createFakeApp(vault);
    const fileOps = new FileOperations(app as any);
    const writer = new InlineTaskWriter(app as any, fileOps);
    return { vault, writer };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('InlineTaskWriter', () => {

    describe('updateTaskInFile', () => {
        it('updates task line with new content', async () => {
            const { vault, writer } = setup({
                'note.md': '- [ ] Old task @2026-03-11',
            });
            const task = makeTask({ originalText: '- [ ] Old task @2026-03-11', line: 0 });
            const updated = { ...task, content: 'New task', startDate: '2026-03-12' };

            await writer.updateTaskInFile(task, updated);

            const result = vault.files.get('note.md')!;
            expect(result).not.toContain('Old task');
            expect(result).toContain('New task');
        });

        it('preserves tab indentation', async () => {
            const { vault, writer } = setup({
                'note.md': '\t- [ ] Indented task @2026-03-11',
            });
            const task = makeTask({
                originalText: '\t- [ ] Indented task @2026-03-11',
                line: 0,
            });
            const updated = { ...task, content: 'Updated' };

            await writer.updateTaskInFile(task, updated);

            const result = vault.files.get('note.md')!;
            expect(result).toMatch(/^\t/);
        });

        it('finds task after line shift via originalText', async () => {
            const { vault, writer } = setup({
                'note.md': [
                    '# Header',
                    'Added line',
                    '- [ ] Target @2026-03-11',
                ].join('\n'),
            });
            // task.line is stale (was line 1, now line 2)
            const task = makeTask({
                originalText: '- [ ] Target @2026-03-11',
                line: 1,
            });
            const updated = { ...task, content: 'Found it' };

            await writer.updateTaskInFile(task, updated);

            const result = vault.files.get('note.md')!;
            expect(result).toContain('Found it');
        });
    });

    describe('updateLine', () => {
        it('updates specific line preserving indentation', async () => {
            const { vault, writer } = setup({
                'note.md': [
                    '- [ ] Task @2026-03-11',
                    '\t- child line',
                ].join('\n'),
            });

            await writer.updateLine('note.md', 1, '- updated child');

            const lines = vault.files.get('note.md')!.split('\n');
            expect(lines[1]).toBe('\t- updated child');
        });

        it('is no-op for out-of-range line number', async () => {
            const { vault, writer } = setup({
                'note.md': '- [ ] Task @2026-03-11',
            });
            const original = vault.files.get('note.md');

            await writer.updateLine('note.md', 99, 'should not appear');

            expect(vault.files.get('note.md')).toBe(original);
        });
    });

    describe('deleteTaskFromFile', () => {
        it('deletes task line and children', async () => {
            const { vault, writer } = setup({
                'note.md': [
                    '- [ ] Task A @2026-03-11',
                    '\tchild 1',
                    '\tchild 2',
                    '- [ ] Task B @2026-03-12',
                ].join('\n'),
            });
            const task = makeTask({
                originalText: '- [ ] Task A @2026-03-11',
                line: 0,
            });

            await writer.deleteTaskFromFile(task);

            const result = vault.files.get('note.md')!;
            expect(result).not.toContain('Task A');
            expect(result).not.toContain('child 1');
            expect(result).toContain('Task B');
        });

        it('deletes single-line task without children', async () => {
            const { vault, writer } = setup({
                'note.md': [
                    '- [ ] Task A @2026-03-11',
                    '- [ ] Task B @2026-03-12',
                ].join('\n'),
            });
            const task = makeTask({
                originalText: '- [ ] Task A @2026-03-11',
                line: 0,
            });

            await writer.deleteTaskFromFile(task);

            const result = vault.files.get('note.md')!;
            expect(result).not.toContain('Task A');
            expect(result).toContain('Task B');
        });

        it('does not affect other tasks', async () => {
            const { vault, writer } = setup({
                'note.md': [
                    '- [ ] Keep @2026-03-10',
                    '- [ ] Delete @2026-03-11',
                    '- [ ] Also keep @2026-03-12',
                ].join('\n'),
            });
            const task = makeTask({
                originalText: '- [ ] Delete @2026-03-11',
                line: 1,
            });

            await writer.deleteTaskFromFile(task);

            const lines = vault.files.get('note.md')!.split('\n');
            expect(lines).toHaveLength(2);
            expect(lines[0]).toContain('Keep');
            expect(lines[1]).toContain('Also keep');
        });
    });

    describe('insertLineAfterTask', () => {
        it('inserts after children', async () => {
            const { vault, writer } = setup({
                'note.md': [
                    '- [ ] Task @2026-03-11',
                    '\tchild 1',
                    '\tchild 2',
                    '- [ ] Next @2026-03-12',
                ].join('\n'),
            });
            const task = makeTask({
                originalText: '- [ ] Task @2026-03-11',
                line: 0,
            });

            const idx = await writer.insertLineAfterTask(task, '- [ ] Inserted @2026-03-13');

            const lines = vault.files.get('note.md')!.split('\n');
            expect(idx).toBe(3);
            expect(lines[3]).toContain('Inserted');
        });

        it('inserts right after task without children', async () => {
            const { vault, writer } = setup({
                'note.md': [
                    '- [ ] Task @2026-03-11',
                    '- [ ] Next @2026-03-12',
                ].join('\n'),
            });
            const task = makeTask({
                originalText: '- [ ] Task @2026-03-11',
                line: 0,
            });

            const idx = await writer.insertLineAfterTask(task, '- [ ] Inserted');

            expect(idx).toBe(1);
            const lines = vault.files.get('note.md')!.split('\n');
            expect(lines[1]).toContain('Inserted');
            expect(lines[2]).toContain('Next');
        });
    });

    describe('insertLineAsFirstChild', () => {
        it('inserts right after task line', async () => {
            const { vault, writer } = setup({
                'note.md': [
                    '- [ ] Task @2026-03-11',
                    '\texisting child',
                ].join('\n'),
            });
            const task = makeTask({
                originalText: '- [ ] Task @2026-03-11',
                line: 0,
            });

            const idx = await writer.insertLineAsFirstChild(task, '\tnew first child');

            expect(idx).toBe(1);
            const lines = vault.files.get('note.md')!.split('\n');
            expect(lines[1]).toBe('\tnew first child');
            expect(lines[2]).toBe('\texisting child');
        });
    });

    describe('appendTaskToFile', () => {
        it('appends to existing file with newline', async () => {
            const { vault, writer } = setup({
                'note.md': '- [ ] Existing @2026-03-11',
            });

            await writer.appendTaskToFile('note.md', '- [ ] Appended @2026-03-12');

            const result = vault.files.get('note.md')!;
            expect(result).toContain('Existing');
            expect(result).toContain('Appended');
            // Should have a newline separator
            expect(result).toBe('- [ ] Existing @2026-03-11\n- [ ] Appended @2026-03-12');
        });

        it('creates file if not exists', async () => {
            const { vault, writer } = setup({});

            await writer.appendTaskToFile('new.md', '- [ ] New task @2026-03-11');

            expect(vault.files.has('new.md')).toBe(true);
            expect(vault.files.get('new.md')).toBe('- [ ] New task @2026-03-11');
        });
    });
});
