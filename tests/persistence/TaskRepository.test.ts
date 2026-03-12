import { describe, it, expect } from 'vitest';
import { TaskRepository } from '../../src/services/persistence/TaskRepository';
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
    const repo = new TaskRepository(app as any);
    return { vault, repo };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TaskRepository', () => {

    describe('replaceInlineTaskWithWikilink', () => {
        it('replaces task + children with wikilink', async () => {
            const { vault, repo } = setup({
                'note.md': [
                    '- [ ] Task @2026-03-11',
                    '\tchild 1',
                    '\tchild 2',
                    '- [ ] Other @2026-03-12',
                ].join('\n'),
            });
            const task = makeTask({
                originalText: '- [ ] Task @2026-03-11',
                line: 0,
            });

            await repo.replaceInlineTaskWithWikilink(task, 'projects/Task.md');

            const result = vault.files.get('note.md')!;
            expect(result).not.toContain('child 1');
            expect(result).not.toContain('child 2');
            expect(result).toContain('[[projects/Task|Task]]');
            expect(result).toContain('Other');
        });

        it('preserves indentation', async () => {
            const { vault, repo } = setup({
                'note.md': '\t- [ ] Nested @2026-03-11',
            });
            const task = makeTask({
                originalText: '\t- [ ] Nested @2026-03-11',
                line: 0,
            });

            await repo.replaceInlineTaskWithWikilink(task, 'Target.md');

            const result = vault.files.get('note.md')!;
            expect(result).toMatch(/^\t/);
        });

        it('uses correct list marker from originalText', async () => {
            const { vault, repo } = setup({
                'note.md': '* [ ] Star task @2026-03-11',
            });
            const task = makeTask({
                originalText: '* [ ] Star task @2026-03-11',
                line: 0,
            });

            await repo.replaceInlineTaskWithWikilink(task, 'Star task.md');

            const result = vault.files.get('note.md')!;
            // Should use * marker, not -
            expect(result).toMatch(/^\*\s/);
        });
    });

    describe('delegation smoke tests', () => {
        it('updateTaskInFile delegates to InlineTaskWriter', async () => {
            const { vault, repo } = setup({
                'note.md': '- [ ] Old @2026-03-11',
            });
            const task = makeTask({
                originalText: '- [ ] Old @2026-03-11',
                line: 0,
            });
            const updated = { ...task, content: 'New', startDate: '2026-03-12' };

            await repo.updateTaskInFile(task, updated);

            const result = vault.files.get('note.md')!;
            expect(result).toContain('New');
        });

        it('deleteTaskFromFile delegates to InlineTaskWriter', async () => {
            const { vault, repo } = setup({
                'note.md': [
                    '- [ ] Delete me @2026-03-11',
                    '- [ ] Keep me @2026-03-12',
                ].join('\n'),
            });
            const task = makeTask({
                originalText: '- [ ] Delete me @2026-03-11',
                line: 0,
            });

            await repo.deleteTaskFromFile(task);

            const result = vault.files.get('note.md')!;
            expect(result).not.toContain('Delete me');
            expect(result).toContain('Keep me');
        });
    });
});
