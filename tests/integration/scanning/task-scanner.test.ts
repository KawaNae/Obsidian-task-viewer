/**
 * TaskScanner Integration Tests
 *
 * These tests verify task scanning behavior via the real Obsidian CLI,
 * replacing the InMemoryVault-based mock tests.
 *
 * Prerequisites:
 *   - Obsidian is running with the Dev vault (C:\Obsidian\Dev) open
 *
 * Run:  npx vitest run tests/integration/scanning/task-scanner.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
    cliList, cliGet, isObsidianRunning, waitForTask,
} from '../helpers/cli-helper';
import {
    createFixture, writeTestFile, deleteTestFile,
    waitForFileIndexed, waitForFileDeindexed,
} from '../helpers/test-file-manager';

const OUTPUT_FIELDS = 'content,status,startDate,startTime,endDate,endTime,due,tags,childIds,parentId,parserId,color,file,line';

beforeAll(() => {
    if (!isObsidianRunning()) {
        throw new Error(
            'Obsidian is not running or CLI is unreachable. ' +
            'Start Obsidian with the Dev vault before running E2E tests.',
        );
    }
});

// ────────────────────────────────────────────
// 1. Basic inline task extraction (@notation)
// ────────────────────────────────────────────
describe('inline task extraction', () => {
    const FILE = 'test-int-scanner-inline.md';
    const fixture = createFixture(FILE, [
        '# Test inline scanning',
        '- [ ] Buy groceries @2026-03-11',
        '- [ ] Task B @2026-03-12',
        '- [x] Task C @2026-03-13',
        '# Not tasks',
        'Plain text paragraph',
        '- regular bullet without date',
    ].join('\n'));

    beforeAll(() => fixture.setup());
    afterAll(() => fixture.teardown());

    it('extracts basic @notation task with correct content and date', () => {
        const r = cliList({ file: FILE, outputFields: OUTPUT_FIELDS });
        const task = r.tasks.find(t => t.content === 'Buy groceries');
        expect(task).toBeDefined();
        expect(task!.startDate).toBe('2026-03-11');
        expect(task!.parserId).toBe('at-notation');
    });

    it('extracts multiple tasks from body', () => {
        const r = cliList({ file: FILE, outputFields: OUTPUT_FIELDS });
        // Should have exactly 3 @notation tasks
        const atTasks = r.tasks.filter(t => t.parserId === 'at-notation');
        expect(atTasks).toHaveLength(3);
    });

    it('skips non-task lines (headings, plain text, regular bullets)', () => {
        const r = cliList({ file: FILE, outputFields: OUTPUT_FIELDS });
        // No task should have content matching non-task lines
        const contents = r.tasks.map(t => t.content as string);
        expect(contents).not.toContain('Test inline scanning');
        expect(contents).not.toContain('Plain text paragraph');
        expect(contents).not.toContain('regular bullet without date');
    });
});

// ────────────────────────────────────────────
// 2. Time-only on non-daily note (skipped)
// ────────────────────────────────────────────
describe('time-only on non-daily note', () => {
    const FILE = 'test-int-scanner-timeonly.md';
    const fixture = createFixture(FILE, [
        '- [ ] Meeting @09:00>10:00',
    ].join('\n'));

    beforeAll(async () => {
        writeTestFile(FILE, '- [ ] Meeting @09:00>10:00');
        // Wait briefly for Obsidian to process
        await new Promise(r => setTimeout(r, 3000));
    });
    afterAll(() => fixture.teardown());

    it('skips time-only task on non-daily note (no date context)', () => {
        const r = cliList({ file: 'test-int-scanner-timeonly', outputFields: OUTPUT_FIELDS });
        // Time-only without daily note context should produce no tasks
        expect(r.count).toBe(0);
    });
});

// ────────────────────────────────────────────
// 3. Daily note date inheritance
// ────────────────────────────────────────────
describe('daily note date inheritance', () => {
    // Use DailyNotes/ folder (matches Dev vault daily note settings)
    const DAILY_NOTE_FILE = 'DailyNotes/2026-08-15.md';
    const fixture = createFixture(DAILY_NOTE_FILE, [
        '- [ ] Morning standup @09:00>09:30',
        '- [ ] Future task @2026-04-01',
    ].join('\n'));

    beforeAll(() => fixture.setup());
    afterAll(() => fixture.teardown());

    it('inherits date for time-only task on daily note', () => {
        const r = cliList({ file: 'DailyNotes/2026-08-15', outputFields: OUTPUT_FIELDS });
        const standup = r.tasks.find(t => (t.content as string).includes('Morning standup'));
        expect(standup).toBeDefined();
        expect(standup!.startDate).toBe('2026-08-15');
        expect(standup!.startTime).toBe('09:00');
        expect(standup!.endTime).toBe('09:30');
    });

    it('does not override explicit startDate on daily note', () => {
        const r = cliList({ file: 'DailyNotes/2026-08-15', outputFields: OUTPUT_FIELDS });
        const future = r.tasks.find(t => (t.content as string).includes('Future task'));
        expect(future).toBeDefined();
        expect(future!.startDate).toBe('2026-04-01');
    });
});

// ────────────────────────────────────────────
// 4. Frontmatter task detection
// ────────────────────────────────────────────
describe('frontmatter tasks', () => {
    const FILE = 'test-int-scanner-frontmatter.md';
    const fixture = createFixture(FILE, [
        '---',
        'tv-start: 2026-03-11',
        'tv-content: Project Alpha',
        '---',
        'Body text here.',
    ].join('\n'));

    beforeAll(() => fixture.setup());
    afterAll(() => fixture.teardown());

    it('creates frontmatter task when tv-start is present', () => {
        const r = cliList({ file: FILE, outputFields: OUTPUT_FIELDS });
        const fmTask = r.tasks.find(t => t.parserId === 'frontmatter');
        expect(fmTask).toBeDefined();
        expect(fmTask!.startDate).toBe('2026-03-11');
        expect(fmTask!.content).toBe('Project Alpha');
    });
});

describe('no frontmatter task when no tv-start/end/due', () => {
    const FILE = 'test-int-scanner-nofm.md';
    const fixture = createFixture(FILE, [
        '---',
        'title: Just a note',
        '---',
        '- [ ] Task A @2026-03-11',
    ].join('\n'));

    beforeAll(() => fixture.setup());
    afterAll(() => fixture.teardown());

    it('has no frontmatter task', () => {
        const r = cliList({ file: FILE, outputFields: OUTPUT_FIELDS });
        const fmTasks = r.tasks.filter(t => t.parserId === 'frontmatter');
        expect(fmTasks).toHaveLength(0);
        // But inline task should still be found
        expect(r.count).toBeGreaterThanOrEqual(1);
    });
});

// ────────────────────────────────────────────
// 5. Child task extraction
// ────────────────────────────────────────────
describe('child task extraction', () => {
    const FILE = 'test-int-scanner-children.md';
    const fixture = createFixture(FILE, [
        '- [ ] Parent task @2026-03-11',
        '\t- child note 1',
        '\t- child note 2',
        '',
        '- [ ] Nested parent @2026-03-12',
        '\t- [ ] Child task @2026-03-13',
        '',
        '- [ ] Stops at blank @2026-03-14',
        '\t- child here',
        '',
        '- [ ] After blank @2026-03-15',
    ].join('\n'));

    beforeAll(() => fixture.setup());
    afterAll(() => fixture.teardown());

    it('parent-child relationship for nested @notation tasks', () => {
        const r = cliList({ file: FILE, outputFields: OUTPUT_FIELDS });
        const parent = r.tasks.find(t => t.content === 'Nested parent');
        const child = r.tasks.find(t => t.content === 'Child task');
        expect(parent).toBeDefined();
        expect(child).toBeDefined();
        expect((parent!.childIds as string[]) ?? []).toContain(child!.id);
        expect(child!.parentId).toBe(parent!.id);
    });

    it('stops child collection at blank line', () => {
        const r = cliList({ file: FILE, outputFields: OUTPUT_FIELDS });
        const stopsAtBlank = r.tasks.find(t => t.content === 'Stops at blank');
        const afterBlank = r.tasks.find(t => t.content === 'After blank');
        expect(stopsAtBlank).toBeDefined();
        expect(afterBlank).toBeDefined();
        // After blank should NOT be a child of "Stops at blank"
        const childIds = (stopsAtBlank!.childIds as string[]) ?? [];
        expect(childIds).not.toContain(afterBlank!.id);
    });
});

// ────────────────────────────────────────────
// 6. tv-ignore: true
// ────────────────────────────────────────────
describe('ignore frontmatter', () => {
    const FILE = 'test-int-scanner-ignore.md';

    beforeAll(async () => {
        writeTestFile(FILE, [
            '---',
            'tv-ignore: true',
            '---',
            '- [ ] Should be ignored @2026-03-11',
        ].join('\n'));
        // Wait for Obsidian to process; since file is ignored, waitForFileIndexed won't work
        await new Promise(r => setTimeout(r, 3000));
    });

    afterAll(async () => {
        deleteTestFile(FILE);
        await waitForFileDeindexed(FILE);
    });

    it('skips file when tv-ignore: true in frontmatter', () => {
        const r = cliList({ file: 'test-int-scanner-ignore', outputFields: OUTPUT_FIELDS });
        expect(r.count).toBe(0);
    });
});

// ────────────────────────────────────────────
// 7. Shared tags from frontmatter
// ────────────────────────────────────────────
describe('shared tags', () => {
    const FILE = 'test-int-scanner-tags.md';
    const fixture = createFixture(FILE, [
        '---',
        'tags: [project, important]',
        '---',
        '- [ ] Tagged task @2026-03-11',
    ].join('\n'));

    beforeAll(() => fixture.setup());
    afterAll(() => fixture.teardown());

    it('merges shared tags from frontmatter into task tags', () => {
        const r = cliList({ file: FILE, outputFields: OUTPUT_FIELDS });
        const task = r.tasks.find(t => t.parserId === 'at-notation');
        expect(task).toBeDefined();
        const tags = task!.tags as string[];
        expect(tags).toContain('project');
        expect(tags).toContain('important');
    });
});

// ────────────────────────────────────────────
// 8. tv-color from frontmatter
// ────────────────────────────────────────────
describe('file-level styling', () => {
    const FILE = 'test-int-scanner-color.md';
    const fixture = createFixture(FILE, [
        '---',
        'tv-color: "#ff0000"',
        '---',
        '- [ ] Red task @2026-03-11',
    ].join('\n'));

    beforeAll(() => fixture.setup());
    afterAll(() => fixture.teardown());

    it('applies tv-color from frontmatter to task', () => {
        const r = cliList({ file: FILE, outputFields: OUTPUT_FIELDS });
        expect(r.count).toBeGreaterThan(0);
        const task = r.tasks.find(t => t.parserId === 'at-notation');
        expect(task).toBeDefined();
        expect(task!.color).toBe('#ff0000');
    });
});
