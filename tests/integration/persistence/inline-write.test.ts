/**
 * Inline Task Writer — CLI Integration Tests
 *
 * Tests inline task CRUD operations via CLI commands and verifies
 * the actual file content on disk matches expectations.
 *
 * Replaces the vault-mock InlineTaskWriter.test.ts with real CLI-based tests.
 *
 * Prerequisites:
 *   - Obsidian is running with the Dev vault (C:\Obsidian\Dev) open
 *
 * Run:  npx vitest run tests/integration/persistence/inline-write.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
    cliList, cliCreate, cliUpdate, cliDelete,
    isObsidianRunning, waitForTask, sleep,
} from '../helpers/cli-helper';
import {
    writeTestFile, readTestFile, deleteTestFile,
    waitForFileIndexed, waitForFileDeindexed,
} from '../helpers/test-file-manager';
import {
    getFileLines, expectFileContains, expectFileNotContains, expectLineContains,
} from '../helpers/vault-assertions';

const TEST_FILE = 'test-int-inline-write.md';
const OUTPUT_FIELDS = 'content,status,startDate,startTime,endDate,endTime,due,tags,parserId,file,line';

// ── Helpers ──

/** Find a task by content substring within our test file. */
function findTask(content: string): Record<string, unknown> | undefined {
    const r = cliList({ file: TEST_FILE, outputFields: OUTPUT_FIELDS });
    return r.tasks.find(t => (t.content as string).includes(content));
}

/** Find a task by content, retrying until indexed. */
async function findTaskWait(content: string, timeoutMs = 8000): Promise<Record<string, unknown> | null> {
    return waitForTask(
        { file: TEST_FILE, outputFields: OUTPUT_FIELDS },
        t => (t.content as string).includes(content),
        timeoutMs,
    );
}

/** Re-fetch a task's current ID by content (IDs change when line numbers shift). */
function freshId(content: string): string {
    const t = findTask(content);
    if (!t) throw new Error(`Task with content "${content}" not found`);
    return t.id as string;
}

// ── Setup / Teardown ──

beforeAll(() => {
    if (!isObsidianRunning()) {
        throw new Error(
            'Obsidian is not running or CLI is unreachable. ' +
            'Start Obsidian with the Dev vault before running integration tests.',
        );
    }
});

afterAll(async () => {
    deleteTestFile(TEST_FILE);
    await waitForFileDeindexed(TEST_FILE);
});

// ────────────────────────────────────────────
// 1. Update — content, dates, status
// ────────────────────────────────────────────
describe('update inline task', () => {
    beforeAll(async () => {
        writeTestFile(TEST_FILE, [
            '- [ ] Original task @2026-05-01',
            '- [ ] Second task @2026-05-02',
            '- [ ] Third task @2026-05-03',
        ].join('\n'));
        await waitForFileIndexed(TEST_FILE);
    });

    it('updates task content', async () => {
        const id = freshId('Original task');

        const r = cliUpdate({ id, content: 'Updated content', outputFields: OUTPUT_FIELDS });
        expect(r).not.toHaveProperty('error');
        expect(r.task.content).toContain('Updated content');

        // Verify file on disk
        await sleep(500);
        expectFileContains(TEST_FILE, 'Updated content');
        expectFileNotContains(TEST_FILE, 'Original task');
    });

    it('updates task start date', async () => {
        const id = freshId('Updated content');

        const r = cliUpdate({ id, start: '2026-06-15', outputFields: OUTPUT_FIELDS });
        expect(r).not.toHaveProperty('error');
        expect(r.task.startDate).toBe('2026-06-15');

        await sleep(500);
        expectFileContains(TEST_FILE, '2026-06-15');
    });

    it('updates task start datetime', async () => {
        const id = freshId('Updated content');

        const r = cliUpdate({ id, start: '2026-06-15T10:30', outputFields: OUTPUT_FIELDS });
        expect(r).not.toHaveProperty('error');
        expect(r.task.startDate).toBe('2026-06-15');
        expect(r.task.startTime).toBe('10:30');

        await sleep(500);
        expectFileContains(TEST_FILE, '10:30');
    });

    it('updates task due date', async () => {
        const id = freshId('Second task');

        const r = cliUpdate({ id, due: '2026-07-01', outputFields: OUTPUT_FIELDS });
        expect(r).not.toHaveProperty('error');
        expect(r.task.due).toBe('2026-07-01');

        await sleep(500);
        expectFileContains(TEST_FILE, '2026-07-01');
    });

    it('updates task status to done', async () => {
        const id = freshId('Third task');

        const r = cliUpdate({ id, status: 'x', outputFields: OUTPUT_FIELDS });
        expect(r).not.toHaveProperty('error');
        expect(r.task.status).toBe('x');

        await sleep(500);
        // The checkbox should now be [x]
        expectFileContains(TEST_FILE, '- [x] Third task');
    });

    it('preserves other tasks when updating one', async () => {
        // After all updates above, Second task and Third task should still exist
        await sleep(300);
        expectFileContains(TEST_FILE, 'Second task');
        expectFileContains(TEST_FILE, 'Third task');
    });
});

// ────────────────────────────────────────────
// 2. Delete — single task, task with children
// ────────────────────────────────────────────
describe('delete inline task', () => {
    beforeAll(async () => {
        writeTestFile(TEST_FILE, [
            '- [ ] Keep me @2026-05-10',
            '- [ ] Delete me @2026-05-11',
            '- [ ] Also keep @2026-05-12',
        ].join('\n'));
        await waitForFileIndexed(TEST_FILE);
    });

    it('deletes a single task', async () => {
        const id = freshId('Delete me');

        const r = cliDelete(id);
        expect(r).not.toHaveProperty('error');
        expect(r.deleted).toBe(id);

        // Wait for Obsidian to process
        await sleep(1000);

        // Verify file: "Delete me" is gone, others remain
        expectFileNotContains(TEST_FILE, 'Delete me');
        expectFileContains(TEST_FILE, 'Keep me');
        expectFileContains(TEST_FILE, 'Also keep');
    });

    it('does not affect other tasks when deleting', async () => {
        // Verify the remaining tasks are still in the index
        const remaining = cliList({ file: TEST_FILE, outputFields: 'content' });
        const contents = remaining.tasks.map(t => t.content as string);
        expect(contents.some(c => c.includes('Keep me'))).toBe(true);
        expect(contents.some(c => c.includes('Also keep'))).toBe(true);
        expect(contents.some(c => c.includes('Delete me'))).toBe(false);
    });
});

describe('delete task with children', () => {
    beforeAll(async () => {
        writeTestFile(TEST_FILE, [
            '- [ ] Parent task @2026-05-20',
            '\t- child line 1',
            '\t- child line 2',
            '- [ ] Sibling task @2026-05-21',
        ].join('\n'));
        await waitForFileIndexed(TEST_FILE);
    });

    it('deletes task line and its children', async () => {
        const id = freshId('Parent task');

        const r = cliDelete(id);
        expect(r).not.toHaveProperty('error');

        await sleep(1000);

        expectFileNotContains(TEST_FILE, 'Parent task');
        expectFileNotContains(TEST_FILE, 'child line 1');
        expectFileNotContains(TEST_FILE, 'child line 2');
        expectFileContains(TEST_FILE, 'Sibling task');
    });
});

// ────────────────────────────────────────────
// 3. Create — append to file, create new file
// ────────────────────────────────────────────
describe('create inline task', () => {
    beforeAll(async () => {
        writeTestFile(TEST_FILE, [
            '- [ ] Existing task @2026-05-01',
        ].join('\n'));
        await waitForFileIndexed(TEST_FILE);
    });

    it('appends a new task to existing file', async () => {
        const r = cliCreate({
            file: TEST_FILE,
            content: 'Newly created task',
            start: '2026-06-01',
            outputFields: OUTPUT_FIELDS,
        });
        expect(r).not.toHaveProperty('error');
        expect(r.task.content).toContain('Newly created task');
        expect(r.task.startDate).toBe('2026-06-01');

        await sleep(1000);

        // Both tasks should exist in the file
        expectFileContains(TEST_FILE, 'Existing task');
        expectFileContains(TEST_FILE, 'Newly created task');
    });

    it('created task has correct parserId', async () => {
        const task = await findTaskWait('Newly created task');
        expect(task).not.toBeNull();
        expect(task!.parserId).toBe('tv-inline');
    });

    it('creates task with end date', async () => {
        const r = cliCreate({
            file: TEST_FILE,
            content: 'Ranged task',
            start: '2026-06-01',
            end: '2026-06-03',
            outputFields: OUTPUT_FIELDS,
        });
        expect(r).not.toHaveProperty('error');
        expect(r.task.startDate).toBe('2026-06-01');
        expect(r.task.endDate).toBe('2026-06-03');

        await sleep(1000);
        expectFileContains(TEST_FILE, 'Ranged task');
    });

    it('creates task with due date', async () => {
        const r = cliCreate({
            file: TEST_FILE,
            content: 'Task with deadline',
            due: '2026-07-15',
            outputFields: OUTPUT_FIELDS,
        });
        expect(r).not.toHaveProperty('error');
        expect(r.task.due).toBe('2026-07-15');

        await sleep(1000);
        expectFileContains(TEST_FILE, 'Task with deadline');
    });

    it('creates task with status', async () => {
        const r = cliCreate({
            file: TEST_FILE,
            content: 'Done task',
            start: '2026-06-01',
            status: 'x',
            outputFields: OUTPUT_FIELDS,
        });
        expect(r).not.toHaveProperty('error');
        expect(r.task.status).toBe('x');

        await sleep(1000);
        expectFileContains(TEST_FILE, '[x] Done task');
    });
});

describe('create task in empty file', () => {
    const NEW_FILE = 'test-int-inline-write-new.md';

    afterAll(async () => {
        deleteTestFile(NEW_FILE);
        await waitForFileDeindexed(NEW_FILE);
    });

    it('creates task in a new empty file', async () => {
        // CLI create requires file to exist — create an empty file first
        writeTestFile(NEW_FILE, '');
        await sleep(1500);

        const r = cliCreate({
            file: NEW_FILE,
            content: 'TaskInNewFile',
            start: '2026-08-01',
            outputFields: OUTPUT_FIELDS,
        });
        expect(r).not.toHaveProperty('error');
        expect(r.task.content).toContain('TaskInNewFile');

        await sleep(1000);

        const content = readTestFile(NEW_FILE);
        expect(content).toContain('TaskInNewFile');
    });
});

// ────────────────────────────────────────────
// 4. Create under heading (frontmatter file)
// ────────────────────────────────────────────
describe('create under heading', () => {
    beforeAll(async () => {
        writeTestFile(TEST_FILE, [
            '---',
            'tv-start: 2026-05-01',
            'tv-content: Project note',
            '---',
            '',
            '## Tasks',
            '- [ ] Existing heading task @2026-05-01',
        ].join('\n'));
        await waitForFileIndexed(TEST_FILE);
    });

    it('creates task under specified heading', async () => {
        const r = cliCreate({
            file: TEST_FILE,
            content: 'Heading task',
            start: '2026-05-15',
            heading: 'Tasks',
            outputFields: OUTPUT_FIELDS,
        });
        expect(r).not.toHaveProperty('error');
        expect(r.task.content).toContain('Heading task');

        await sleep(1000);

        // Verify the task appears under the ## Tasks heading
        const lines = getFileLines(TEST_FILE);
        const headingIdx = lines.findIndex(l => l.includes('## Tasks'));
        expect(headingIdx).toBeGreaterThan(-1);

        // The new task should be somewhere after the heading
        const afterHeading = lines.slice(headingIdx + 1).join('\n');
        expect(afterHeading).toContain('Heading task');
    });
});

// ────────────────────────────────────────────
// 5. Round-trip: create → update → verify file → delete → verify file
// ────────────────────────────────────────────
describe('full round-trip', () => {
    beforeAll(async () => {
        writeTestFile(TEST_FILE, '');
        // Wait a bit for Obsidian to notice the empty file
        await sleep(1000);
    });

    it('create → update → delete with file verification', async () => {
        // Step 1: Create
        const created = cliCreate({
            file: TEST_FILE,
            content: 'Round-trip task',
            start: '2026-09-01',
            outputFields: OUTPUT_FIELDS,
        });
        expect(created).not.toHaveProperty('error');
        const createId = created.task.id as string;

        await sleep(1000);
        expectFileContains(TEST_FILE, 'Round-trip task');
        expectFileContains(TEST_FILE, '2026-09-01');

        // Step 2: Update content + date
        const currentId = freshId('Round-trip task');
        const updated = cliUpdate({
            id: currentId,
            content: 'Round-trip updated',
            start: '2026-09-15',
            outputFields: OUTPUT_FIELDS,
        });
        expect(updated).not.toHaveProperty('error');
        expect(updated.task.content).toContain('Round-trip updated');
        expect(updated.task.startDate).toBe('2026-09-15');

        await sleep(1000);
        expectFileContains(TEST_FILE, 'Round-trip updated');
        expectFileContains(TEST_FILE, '2026-09-15');
        expectFileNotContains(TEST_FILE, 'Round-trip task');

        // Step 3: Delete
        const deleteId = freshId('Round-trip updated');
        const deleted = cliDelete(deleteId);
        expect(deleted).not.toHaveProperty('error');

        await sleep(1000);
        expectFileNotContains(TEST_FILE, 'Round-trip updated');
    });
});

// ────────────────────────────────────────────
// 6. Clear status via "none" sentinel
// ────────────────────────────────────────────
describe('clear status via none sentinel', () => {
    beforeAll(async () => {
        writeTestFile(TEST_FILE, [
            '- [x] Completed task @2026-05-01',
        ].join('\n'));
        await waitForFileIndexed(TEST_FILE);
    });

    it('unchecks task via status=none', async () => {
        const task = await findTaskWait('Completed task');
        expect(task).not.toBeNull();
        expect(task!.status).toBe('x');

        const id = task!.id as string;
        const r = cliUpdate({ id, status: 'none', outputFields: OUTPUT_FIELDS });
        expect(r).not.toHaveProperty('error');
        expect(r.task.status).toBe(' ');

        await sleep(500);
        expectFileContains(TEST_FILE, '- [ ] Completed task');
        expectFileNotContains(TEST_FILE, '- [x]');
    });
});
