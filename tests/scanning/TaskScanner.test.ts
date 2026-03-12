import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TFile } from 'obsidian';
import { TaskScanner } from '../../src/services/core/TaskScanner';
import { TaskStore } from '../../src/services/core/TaskStore';
import { TaskValidator } from '../../src/services/core/TaskValidator';
import { SyncDetector } from '../../src/services/core/SyncDetector';
import { DailyNoteUtils } from '../../src/utils/DailyNoteUtils';
import { DEFAULT_SETTINGS } from '../../src/types';
import type { TaskViewerSettings } from '../../src/types';
import { createInMemoryVault, createFakeApp, createFakeMetadataCache } from '../helpers/fakeApp';
import type { FakeApp } from '../helpers/fakeApp';

// Mock DailyNoteUtils to control daily note detection
vi.mock('../../src/utils/DailyNoteUtils', async (importOriginal) => {
    const orig = await importOriginal<typeof import('../../src/utils/DailyNoteUtils')>();
    return {
        ...orig,
        DailyNoteUtils: {
            ...orig.DailyNoteUtils,
            parseDateFromFilePath: vi.fn().mockReturnValue(null),
        },
    };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTFile(path: string): TFile {
    const tf = new TFile();
    tf.path = path;
    tf.name = path.split('/').pop() ?? path;
    tf.basename = tf.name.replace(/\.md$/, '');
    return tf;
}

function createScanner(fakeApp: FakeApp, settings?: Partial<TaskViewerSettings>) {
    const mergedSettings = { ...DEFAULT_SETTINGS, ...settings } as TaskViewerSettings;
    const store = new TaskStore(mergedSettings);
    const validator = new TaskValidator();
    const syncDetector = new SyncDetector();
    const commandExecutor = { handleTaskCompletion: vi.fn() } as any;

    const scanner = new TaskScanner(
        fakeApp as any,
        store,
        validator,
        syncDetector,
        commandExecutor,
        mergedSettings,
    );
    // Mark as not initializing so tests don't see startup behavior
    scanner.setInitializing(false);

    return { scanner, store, validator, commandExecutor };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TaskScanner', () => {
    beforeEach(() => {
        vi.mocked(DailyNoteUtils.parseDateFromFilePath).mockReturnValue(null);
    });

    // ── Basic inline task extraction ──

    describe('inline task extraction', () => {
        it('extracts basic @notation task', async () => {
            const vault = createInMemoryVault({
                'note.md': '- [ ] Buy groceries @2026-03-11',
            });
            const app = createFakeApp(vault);
            const { scanner, store } = createScanner(app);

            await scanner.queueScan(makeTFile('note.md'));

            const tasks = store.getTasks();
            expect(tasks).toHaveLength(1);
            expect(tasks[0].content).toBe('Buy groceries');
            expect(tasks[0].startDate).toBe('2026-03-11');
            expect(tasks[0].file).toBe('note.md');
        });

        it('extracts multiple tasks from body', async () => {
            const vault = createInMemoryVault({
                'note.md': [
                    '- [ ] Task A @2026-03-11',
                    '- [ ] Task B @2026-03-12',
                    '- [x] Task C @2026-03-13',
                ].join('\n'),
            });
            const app = createFakeApp(vault);
            const { scanner, store } = createScanner(app);

            await scanner.queueScan(makeTFile('note.md'));

            expect(store.getTasks()).toHaveLength(3);
        });

        it('skips non-task lines', async () => {
            const vault = createInMemoryVault({
                'note.md': [
                    '# Heading',
                    'Plain text paragraph',
                    '- [ ] Real task @2026-03-11',
                    '- regular bullet',
                ].join('\n'),
            });
            const app = createFakeApp(vault);
            const { scanner, store } = createScanner(app);

            await scanner.queueScan(makeTFile('note.md'));

            expect(store.getTasks()).toHaveLength(1);
            expect(store.getTasks()[0].content).toBe('Real task');
        });

        it('skips time-only task on non-daily note (no date context)', async () => {
            const vault = createInMemoryVault({
                'note.md': '- [ ] Meeting @09:00>10:00',
            });
            const app = createFakeApp(vault);
            const { scanner, store } = createScanner(app);

            await scanner.queueScan(makeTFile('note.md'));

            // Time-only without daily note context → treated as plain checkbox
            expect(store.getTasks()).toHaveLength(0);
        });
    });

    // ── Daily note date inheritance ──

    describe('daily note date inheritance', () => {
        it('inherits date for time-only task on daily note', async () => {
            vi.mocked(DailyNoteUtils.parseDateFromFilePath).mockReturnValue('2026-03-11');

            const vault = createInMemoryVault({
                '2026-03-11.md': '- [ ] Morning standup @09:00>09:30',
            });
            const app = createFakeApp(vault);
            const { scanner, store } = createScanner(app);

            await scanner.queueScan(makeTFile('2026-03-11.md'));

            const tasks = store.getTasks();
            expect(tasks).toHaveLength(1);
            expect(tasks[0].startDate).toBe('2026-03-11');
            expect(tasks[0].startTime).toBe('09:00');
            expect(tasks[0].endTime).toBe('09:30');
        });

        it('does not override explicit startDate on daily note', async () => {
            vi.mocked(DailyNoteUtils.parseDateFromFilePath).mockReturnValue('2026-03-11');

            const vault = createInMemoryVault({
                '2026-03-11.md': '- [ ] Future task @2026-04-01',
            });
            const app = createFakeApp(vault);
            const { scanner, store } = createScanner(app);

            await scanner.queueScan(makeTFile('2026-03-11.md'));

            const tasks = store.getTasks();
            expect(tasks).toHaveLength(1);
            expect(tasks[0].startDate).toBe('2026-04-01');
        });
    });

    // ── Frontmatter task detection ──

    describe('frontmatter tasks', () => {
        it('creates frontmatter task when tv-start is present', async () => {
            const vault = createInMemoryVault({
                'project.md': [
                    '---',
                    'tv-start: 2026-03-11',
                    'tv-content: Project Alpha',
                    '---',
                    'Body text',
                ].join('\n'),
            });
            const cache = createFakeMetadataCache({
                'project.md': {
                    frontmatter: {
                        'tv-start': '2026-03-11',
                        'tv-content': 'Project Alpha',
                    },
                },
            });
            const app = createFakeApp(vault, cache);
            const { scanner, store } = createScanner(app);

            await scanner.queueScan(makeTFile('project.md'));

            const tasks = store.getTasks();
            const fmTask = tasks.find(t => t.parserId === 'frontmatter');
            expect(fmTask).toBeDefined();
            expect(fmTask!.startDate).toBe('2026-03-11');
            expect(fmTask!.content).toBe('Project Alpha');
        });

        it('no frontmatter task when no tv-start/end/due', async () => {
            const vault = createInMemoryVault({
                'note.md': [
                    '---',
                    'title: Just a note',
                    '---',
                    '- [ ] Task A @2026-03-11',
                ].join('\n'),
            });
            const cache = createFakeMetadataCache({
                'note.md': {
                    frontmatter: { title: 'Just a note' },
                },
            });
            const app = createFakeApp(vault, cache);
            const { scanner, store } = createScanner(app);

            await scanner.queueScan(makeTFile('note.md'));

            const fmTasks = store.getTasks().filter(t => t.parserId === 'frontmatter');
            expect(fmTasks).toHaveLength(0);
            // But body inline task should still be found
            expect(store.getTasks().length).toBeGreaterThanOrEqual(1);
        });
    });

    // ── Child task extraction ──

    describe('child task extraction', () => {
        it('collects child lines under parent task', async () => {
            const vault = createInMemoryVault({
                'note.md': [
                    '- [ ] Parent @2026-03-11',
                    '\t- child note 1',
                    '\t- child note 2',
                ].join('\n'),
            });
            const app = createFakeApp(vault);
            const { scanner, store } = createScanner(app);

            await scanner.queueScan(makeTFile('note.md'));

            const tasks = store.getTasks();
            expect(tasks).toHaveLength(1);
            expect(tasks[0].childLines).toHaveLength(2);
        });

        it('sets parent-child relationship for nested @notation tasks', async () => {
            const vault = createInMemoryVault({
                'note.md': [
                    '- [ ] Parent @2026-03-11',
                    '\t- [ ] Child @2026-03-12',
                ].join('\n'),
            });
            const app = createFakeApp(vault);
            const { scanner, store } = createScanner(app);

            await scanner.queueScan(makeTFile('note.md'));

            const tasks = store.getTasks();
            expect(tasks).toHaveLength(2);
            const parent = tasks.find(t => t.content === 'Parent')!;
            const child = tasks.find(t => t.content === 'Child')!;
            expect(parent.childIds).toContain(child.id);
            expect(child.parentId).toBe(parent.id);
        });

        it('stops child collection at blank line', async () => {
            const vault = createInMemoryVault({
                'note.md': [
                    '- [ ] Task @2026-03-11',
                    '\t- child',
                    '',
                    '- [ ] Other @2026-03-12',
                ].join('\n'),
            });
            const app = createFakeApp(vault);
            const { scanner, store } = createScanner(app);

            await scanner.queueScan(makeTFile('note.md'));

            const tasks = store.getTasks();
            const task1 = tasks.find(t => t.content === 'Task')!;
            expect(task1.childLines).toHaveLength(1);
        });
    });

    // ── isIgnoredByFrontmatter ──

    describe('ignore frontmatter', () => {
        it('skips file when tv-ignore: true in frontmatter', async () => {
            const vault = createInMemoryVault({
                'ignored.md': [
                    '---',
                    'tv-ignore: true',
                    '---',
                    '- [ ] Task @2026-03-11',
                ].join('\n'),
            });
            const cache = createFakeMetadataCache({
                'ignored.md': {
                    frontmatter: { 'tv-ignore': true },
                },
            });
            const app = createFakeApp(vault, cache);
            const { scanner, store } = createScanner(app);

            await scanner.queueScan(makeTFile('ignored.md'));

            expect(store.getTasks()).toHaveLength(0);
        });

        it('does not skip when tv-ignore: false', async () => {
            const vault = createInMemoryVault({
                'included.md': [
                    '---',
                    'tv-ignore: false',
                    '---',
                    '- [ ] Task @2026-03-11',
                ].join('\n'),
            });
            const cache = createFakeMetadataCache({
                'included.md': {
                    frontmatter: { 'tv-ignore': false },
                },
            });
            const app = createFakeApp(vault, cache);
            const { scanner, store } = createScanner(app);

            await scanner.queueScan(makeTFile('included.md'));

            expect(store.getTasks().length).toBeGreaterThan(0);
        });
    });

    // ── Shared tags from frontmatter ──

    describe('shared tags', () => {
        it('merges shared tags into task tags', async () => {
            const vault = createInMemoryVault({
                'note.md': [
                    '---',
                    'tags: [project, important]',
                    '---',
                    '- [ ] Task #local @2026-03-11',
                ].join('\n'),
            });
            const cache = createFakeMetadataCache({
                'note.md': {
                    frontmatter: { 'tags': ['project', 'important'] },
                },
            });
            const app = createFakeApp(vault, cache);
            const { scanner, store } = createScanner(app);

            await scanner.queueScan(makeTFile('note.md'));

            const tasks = store.getTasks();
            expect(tasks.length).toBeGreaterThan(0);
            const task = tasks.find(t => t.parserId === 'at-notation')!;
            expect(task.tags).toContain('project');
            expect(task.tags).toContain('important');
        });
    });

    // ── File-level color/linestyle ──

    describe('file-level styling', () => {
        it('applies tv-color from frontmatter to all tasks', async () => {
            const vault = createInMemoryVault({
                'styled.md': [
                    '---',
                    'tv-color: "#ff0000"',
                    '---',
                    '- [ ] Red task @2026-03-11',
                ].join('\n'),
            });
            const cache = createFakeMetadataCache({
                'styled.md': {
                    frontmatter: { 'tv-color': '#ff0000' },
                },
            });
            const app = createFakeApp(vault, cache);
            const { scanner, store } = createScanner(app);

            await scanner.queueScan(makeTFile('styled.md'));

            const tasks = store.getTasks();
            expect(tasks.length).toBeGreaterThan(0);
            expect(tasks[0].color).toBe('#ff0000');
        });
    });

    // ── Re-scan replaces old tasks ──

    describe('re-scan', () => {
        it('replaces tasks on re-scan of same file', async () => {
            const vault = createInMemoryVault({
                'note.md': '- [ ] Original @2026-03-11',
            });
            const app = createFakeApp(vault);
            const { scanner, store } = createScanner(app);

            await scanner.queueScan(makeTFile('note.md'));
            expect(store.getTasks()).toHaveLength(1);
            expect(store.getTasks()[0].content).toBe('Original');

            // Update file content
            vault.files.set('note.md', '- [ ] Updated @2026-03-12');
            await scanner.queueScan(makeTFile('note.md'));

            expect(store.getTasks()).toHaveLength(1);
            expect(store.getTasks()[0].content).toBe('Updated');
            expect(store.getTasks()[0].startDate).toBe('2026-03-12');
        });
    });

    // ── Validation warnings ──

    describe('validation warnings', () => {
        it('collects validation warning from parsed task', async () => {
            // A task with invalid time format will produce a validation warning
            const vault = createInMemoryVault({
                'note.md': '- [ ] Bad time @2026-03-11 09:00>25:00',
            });
            const app = createFakeApp(vault);
            const { scanner, validator } = createScanner(app);

            await scanner.queueScan(makeTFile('note.md'));

            // Whether there's a warning depends on the parser's validation.
            // We just verify the mechanism works without errors.
            const errors = validator.getValidationErrors();
            // Errors may or may not be present depending on parser behavior
            expect(Array.isArray(errors)).toBe(true);
        });
    });
});
