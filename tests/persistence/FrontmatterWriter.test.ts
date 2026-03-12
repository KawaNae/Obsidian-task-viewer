import { describe, it, expect } from 'vitest';
import { FrontmatterWriter } from '../../src/services/persistence/writers/FrontmatterWriter';
import { FileOperations } from '../../src/services/persistence/utils/FileOperations';
import { DEFAULT_FRONTMATTER_TASK_KEYS } from '../../src/types';
import type { Task, FrontmatterTaskKeys } from '../../src/types';
import { createInMemoryVault, createFakeApp } from '../helpers/fakeApp';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const keys = DEFAULT_FRONTMATTER_TASK_KEYS;

function makeFmTask(overrides: Partial<Task> = {}): Task {
    return {
        id: 'frontmatter:project.md:fm-root',
        file: overrides.file ?? 'project.md',
        line: -1,
        content: overrides.content ?? 'Project',
        statusChar: overrides.statusChar ?? ' ',
        indent: 0,
        childIds: [],
        childLines: [],
        childLineBodyOffsets: [],
        originalText: '',
        tags: [],
        parserId: 'frontmatter',
        ...overrides,
    };
}

function setup(fileContents: Record<string, string>) {
    const vault = createInMemoryVault(fileContents);
    const app = createFakeApp(vault);
    const fileOps = new FileOperations(app as any);
    const writer = new FrontmatterWriter(app as any, fileOps);
    return { vault, writer };
}

const baseFm = [
    '---',
    'tv-start: 2026-03-11',
    'tv-content: Project',
    '---',
    'body',
].join('\n');

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FrontmatterWriter', () => {

    describe('updateFrontmatterTask', () => {
        it('updates statusChar to x', async () => {
            const { vault, writer } = setup({ 'project.md': baseFm });
            const task = makeFmTask({ statusChar: 'x' });

            await writer.updateFrontmatterTask(task, { statusChar: 'x' }, keys);

            const result = vault.files.get('project.md')!;
            expect(result).toContain('tv-status: x');
        });

        it('deletes status key when statusChar is space', async () => {
            const fm = baseFm.replace('---\nbody', 'tv-status: x\n---\nbody');
            const { vault, writer } = setup({ 'project.md': fm });
            const task = makeFmTask({ statusChar: ' ' });

            await writer.updateFrontmatterTask(task, { statusChar: ' ' }, keys);

            const result = vault.files.get('project.md')!;
            expect(result).not.toContain('tv-status');
        });

        it('escapes special status chars with quotes', async () => {
            const { vault, writer } = setup({ 'project.md': baseFm });
            const task = makeFmTask({ statusChar: '?' });

            await writer.updateFrontmatterTask(task, { statusChar: '?' }, keys);

            const result = vault.files.get('project.md')!;
            expect(result).toContain('tv-status: "?"');
        });

        it('updates startDate + startTime → datetime format', async () => {
            const { vault, writer } = setup({ 'project.md': baseFm });
            const task = makeFmTask({ startDate: '2026-04-01', startTime: '09:00' });

            await writer.updateFrontmatterTask(task, { startDate: '2026-04-01', startTime: '09:00' }, keys);

            const result = vault.files.get('project.md')!;
            expect(result).toContain('tv-start: 2026-04-01T09:00');
        });

        it('updates due', async () => {
            const { vault, writer } = setup({ 'project.md': baseFm });
            const task = makeFmTask({ due: '2026-04-15' });

            await writer.updateFrontmatterTask(task, { due: '2026-04-15' }, keys);

            const result = vault.files.get('project.md')!;
            expect(result).toContain('tv-due: 2026-04-15');
        });

        it('deletes due when cleared', async () => {
            const fm = baseFm.replace('---\nbody', 'tv-due: 2026-04-15\n---\nbody');
            const { vault, writer } = setup({ 'project.md': fm });
            const task = makeFmTask({ due: undefined });

            await writer.updateFrontmatterTask(task, { due: undefined }, keys);

            const result = vault.files.get('project.md')!;
            expect(result).not.toContain('tv-due');
        });

        it('updates content', async () => {
            const { vault, writer } = setup({ 'project.md': baseFm });
            const task = makeFmTask({ content: 'New Name' });

            await writer.updateFrontmatterTask(task, { content: 'New Name' }, keys);

            const result = vault.files.get('project.md')!;
            expect(result).toContain('tv-content: New Name');
        });
    });

    describe('deleteFrontmatterTask', () => {
        it('removes all task keys', async () => {
            const fm = [
                '---',
                'tv-start: 2026-03-11',
                'tv-end: 2026-03-12',
                'tv-due: 2026-03-20',
                'tv-status: x',
                'tv-content: Project',
                'other-key: keep',
                '---',
            ].join('\n');
            const { vault, writer } = setup({ 'project.md': fm });
            const task = makeFmTask();

            await writer.deleteFrontmatterTask(task, keys);

            const result = vault.files.get('project.md')!;
            expect(result).not.toContain('tv-start');
            expect(result).not.toContain('tv-end');
            expect(result).not.toContain('tv-due');
            expect(result).not.toContain('tv-status');
            expect(result).not.toContain('tv-content');
            expect(result).toContain('other-key: keep');
        });

        it('preserves non-task frontmatter keys', async () => {
            const fm = [
                '---',
                'title: My Note',
                'tv-start: 2026-03-11',
                'tags: [a, b]',
                '---',
            ].join('\n');
            const { vault, writer } = setup({ 'project.md': fm });
            const task = makeFmTask();

            await writer.deleteFrontmatterTask(task, keys);

            const result = vault.files.get('project.md')!;
            expect(result).toContain('title: My Note');
            expect(result).toContain('tags: [a, b]');
        });
    });

    describe('insertLineAfterFrontmatter', () => {
        it('inserts under existing heading', async () => {
            const content = [
                '---',
                'tv-start: 2026-03-11',
                '---',
                '## Tasks',
                '- existing',
            ].join('\n');
            const { vault, writer } = setup({ 'project.md': content });

            await writer.insertLineAfterFrontmatter('project.md', '- [ ] New task', 'Tasks', 2);

            const result = vault.files.get('project.md')!;
            expect(result).toContain('- [ ] New task');
        });

        it('creates heading at EOF when not found', async () => {
            const content = [
                '---',
                'tv-start: 2026-03-11',
                '---',
                'body text',
            ].join('\n');
            const { vault, writer } = setup({ 'project.md': content });

            await writer.insertLineAfterFrontmatter('project.md', '- [ ] New task', 'Tasks', 2);

            const result = vault.files.get('project.md')!;
            expect(result).toContain('## Tasks');
            expect(result).toContain('- [ ] New task');
        });
    });
});
