import { describe, it, expect } from 'vitest';
import { TaskConverter } from '../../src/services/persistence/TaskConverter';
import { FileOperations } from '../../src/services/persistence/utils/FileOperations';
import { DEFAULT_FRONTMATTER_TASK_KEYS } from '../../src/types';
import type { Task, ChildLine } from '../../src/types';
import { createInMemoryVault, createFakeApp } from '../helpers/fakeApp';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<Task> = {}): Task {
    return {
        id: 'at-notation:note.md:ln:1',
        file: 'note.md',
        line: 0,
        content: overrides.content ?? 'My Task',
        statusChar: overrides.statusChar ?? ' ',
        indent: 0,
        childIds: [],
        childLines: overrides.childLines ?? [],
        childLineBodyOffsets: [],
        originalText: '- [ ] My Task @2026-03-11',
        tags: overrides.tags ?? [],
        parserId: 'at-notation',
        ...overrides,
    };
}

function makeChildLine(text: string): ChildLine {
    return {
        text,
        indent: text.match(/^(\s*)/)?.[1] ?? '',
        checkboxChar: null,
        wikilinkTarget: null,
    };
}

function setup(fileContents: Record<string, string> = {}) {
    const vault = createInMemoryVault(fileContents);
    const app = createFakeApp(vault);
    const fileOps = new FileOperations(app as any);
    const converter = new TaskConverter(app as any, fileOps);
    return { vault, converter };
}

const keys = DEFAULT_FRONTMATTER_TASK_KEYS;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TaskConverter', () => {

    describe('convertToFrontmatterTask — frontmatter generation', () => {
        it('generates basic frontmatter with start and content', async () => {
            const { vault, converter } = setup();
            const task = makeTask({ startDate: '2026-03-11', content: 'Project Alpha' });

            const path = await converter.convertToFrontmatterTask(task, 'Tasks', 2, undefined, undefined, keys);

            const content = vault.files.get(path)!;
            expect(content).toContain('tv-start: 2026-03-11');
            expect(content).toContain('tv-content: Project Alpha');
            expect(content).toMatch(/^---\n/);
        });

        it('includes end datetime', async () => {
            const { vault, converter } = setup();
            const task = makeTask({
                startDate: '2026-03-11',
                startTime: '09:00',
                endDate: '2026-03-11',
                endTime: '17:00',
            });

            const path = await converter.convertToFrontmatterTask(task, 'Tasks', 2, undefined, undefined, keys);

            const content = vault.files.get(path)!;
            expect(content).toContain('tv-start: 2026-03-11T09:00');
            expect(content).toContain('tv-end: 2026-03-11T17:00');
        });

        it('includes due', async () => {
            const { vault, converter } = setup();
            const task = makeTask({ startDate: '2026-03-11', due: '2026-03-20' });

            const path = await converter.convertToFrontmatterTask(task, 'Tasks', 2, undefined, undefined, keys);

            const content = vault.files.get(path)!;
            expect(content).toContain('tv-due: 2026-03-20');
        });

        it('includes status when not space', async () => {
            const { vault, converter } = setup();
            const task = makeTask({ startDate: '2026-03-11', statusChar: 'x' });

            const path = await converter.convertToFrontmatterTask(task, 'Tasks', 2, undefined, undefined, keys);

            const content = vault.files.get(path)!;
            expect(content).toContain('tv-status: x');
        });

        it('omits status when space', async () => {
            const { vault, converter } = setup();
            const task = makeTask({ startDate: '2026-03-11', statusChar: ' ' });

            const path = await converter.convertToFrontmatterTask(task, 'Tasks', 2, undefined, undefined, keys);

            const content = vault.files.get(path)!;
            expect(content).not.toContain('tv-status');
        });

        it('S-timed task does not produce tv-end', async () => {
            const { vault, converter } = setup();
            const task = makeTask({
                startDate: '2026-03-14',
                startTime: '14:00',
            });

            const path = await converter.convertToFrontmatterTask(task, 'Tasks', 2, undefined, undefined, keys);

            const content = vault.files.get(path)!;
            expect(content).toContain('tv-start: 2026-03-14T14:00');
            expect(content).not.toContain('tv-end');
        });

        it('S-AllDay task does not produce tv-end', async () => {
            const { vault, converter } = setup();
            const task = makeTask({ startDate: '2026-03-14' });

            const path = await converter.convertToFrontmatterTask(task, 'Tasks', 2, undefined, undefined, keys);

            const content = vault.files.get(path)!;
            expect(content).toContain('tv-start: 2026-03-14');
            expect(content).not.toContain('tv-end');
        });

        it('endTime-only uses startDate as fallback for same-day', async () => {
            const { vault, converter } = setup();
            const task = makeTask({
                startDate: '2026-03-14',
                startTime: '09:00',
                endTime: '17:00',
            });

            const path = await converter.convertToFrontmatterTask(task, 'Tasks', 2, undefined, undefined, keys);

            const content = vault.files.get(path)!;
            expect(content).toContain('tv-end: 2026-03-14T17:00');
        });

        it('SE-AllDay produces tv-start and tv-end without time', async () => {
            const { vault, converter } = setup();
            const task = makeTask({ startDate: '2026-03-14', endDate: '2026-03-16' });

            const path = await converter.convertToFrontmatterTask(task, 'Tasks', 2, undefined, undefined, keys);

            const content = vault.files.get(path)!;
            expect(content).toContain('tv-start: 2026-03-14');
            expect(content).toContain('tv-end: 2026-03-16');
            expect(content).not.toMatch(/tv-start:.*T/);
            expect(content).not.toMatch(/tv-end:.*T/);
        });

        it('E-Timed produces only tv-end with datetime, no tv-start', async () => {
            const { vault, converter } = setup();
            const task = makeTask({ endDate: '2026-03-14', endTime: '17:00' });

            const path = await converter.convertToFrontmatterTask(task, 'Tasks', 2, undefined, undefined, keys);

            const content = vault.files.get(path)!;
            expect(content).toContain('tv-end: 2026-03-14T17:00');
            expect(content).not.toContain('tv-start');
        });

        it('E-AllDay produces only tv-end, no tv-start', async () => {
            const { vault, converter } = setup();
            const task = makeTask({ endDate: '2026-03-14' });

            const path = await converter.convertToFrontmatterTask(task, 'Tasks', 2, undefined, undefined, keys);

            const content = vault.files.get(path)!;
            expect(content).toContain('tv-end: 2026-03-14');
            expect(content).not.toContain('tv-start');
        });

        it('D-type produces only tv-due, no tv-start or tv-end', async () => {
            const { vault, converter } = setup();
            const task = makeTask({ due: '2026-03-20' });

            const path = await converter.convertToFrontmatterTask(task, 'Tasks', 2, undefined, undefined, keys);

            const content = vault.files.get(path)!;
            expect(content).toContain('tv-due: 2026-03-20');
            expect(content).not.toContain('tv-start');
            expect(content).not.toContain('tv-end');
        });

        it('task with no dates produces no date keys', async () => {
            const { vault, converter } = setup();
            const task = makeTask({});

            const path = await converter.convertToFrontmatterTask(task, 'Tasks', 2, undefined, undefined, keys);

            const content = vault.files.get(path)!;
            expect(content).toContain('tv-content: My Task');
            expect(content).not.toContain('tv-start');
            expect(content).not.toContain('tv-end');
            expect(content).not.toContain('tv-due');
        });

        it('includes color and sharedTags', async () => {
            const { vault, converter } = setup();
            const task = makeTask({
                startDate: '2026-03-11',
                tags: ['project', 'shared-tag', 'own-tag'],
            });

            const path = await converter.convertToFrontmatterTask(
                task, 'Tasks', 2, '#ff0000', ['shared-tag'], keys
            );

            const content = vault.files.get(path)!;
            expect(content).toContain('tv-color: "#ff0000"');
            // sharedtags key === 'tags' → all tags merged into single tags: line
            expect(content).toContain('tags: [own-tag, project, shared-tag]');
        });
    });

    describe('convertToFrontmatterTask — body', () => {
        it('generates body with heading when childLines present', async () => {
            const { vault, converter } = setup();
            const task = makeTask({
                startDate: '2026-03-11',
                childLines: [
                    makeChildLine('- [ ] Subtask 1'),
                    makeChildLine('- [ ] Subtask 2'),
                ],
            });

            const path = await converter.convertToFrontmatterTask(task, 'Tasks', 2, undefined, undefined, keys);

            const content = vault.files.get(path)!;
            expect(content).toContain('## Tasks');
            expect(content).toContain('- [ ] Subtask 1');
            expect(content).toContain('- [ ] Subtask 2');
        });

        it('no body section when no childLines', async () => {
            const { vault, converter } = setup();
            const task = makeTask({ startDate: '2026-03-11', childLines: [] });

            const path = await converter.convertToFrontmatterTask(task, 'Tasks', 2, undefined, undefined, keys);

            const content = vault.files.get(path)!;
            expect(content).not.toContain('## Tasks');
            // Should end with closing ---
            expect(content.trim()).toMatch(/---$/);
        });
    });

    describe('convertToFrontmatterTask — filename generation', () => {
        it('uses content as filename', async () => {
            const { converter } = setup();
            const task = makeTask({ startDate: '2026-03-11', content: 'Project Alpha' });

            const path = await converter.convertToFrontmatterTask(task, 'Tasks', 2, undefined, undefined, keys);

            expect(path).toBe('Project Alpha.md');
        });

        it('auto-numbers on collision', async () => {
            const { converter } = setup({ 'My Task.md': 'existing' });
            const task = makeTask({ startDate: '2026-03-11', content: 'My Task' });

            const path = await converter.convertToFrontmatterTask(task, 'Tasks', 2, undefined, undefined, keys);

            expect(path).toBe('My Task 2.md');
        });
    });
});
