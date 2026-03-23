/**
 * Generation Commands Integration Tests
 *
 * Tests repeat, next, and move commands via CLI update.
 * Prerequisites:
 *   - Obsidian is running with the Dev vault (C:\Obsidian\Dev) open
 *
 * Run:  npx vitest run tests/integration/generation/cli-generation.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
    cliList, cliUpdate, cliDelete,
    isObsidianRunning, waitForTask, waitForTaskGone, sleep,
} from '../helpers/cli-helper';
import {
    writeTestFile, deleteTestFile,
    waitForFileIndexed, waitForFileDeindexed, vaultAbsolute,
} from '../helpers/test-file-manager';
import * as fs from 'fs';

const TEST_FILE = 'test-int-generation.md';
const ARCHIVE_FILE = 'test-archive.md';

const FIXTURE_CONTENT = [
    '# Generation Commands テスト',
    '',
    '## repeat',
    '- [ ] repeat-test-A @2026-04-01 ==> repeat(1 day)',
    '- [ ] repeat-test-B @2026-04-01>2026-04-03 ==> repeat(7 days)',
    '',
    '## next',
    '- [ ] next-test-A @2026-04-01 ==> next(3 days)',
    '',
    '## move',
    '- [ ] move-test-A @2026-04-01 ==> move(test-archive)',
].join('\n');

/** Find a task by content substring in the test file */
function findTask(contentSubstr: string, outputFields = 'id,content,status,startDate,endDate') {
    const r = cliList({ file: TEST_FILE, outputFields });
    return r.tasks.find(t => (t.content as string).includes(contentSubstr));
}

/** Reset fixture to clean state */
async function resetFixture(): Promise<void> {
    writeTestFile(TEST_FILE, FIXTURE_CONTENT);
    await waitForFileIndexed(TEST_FILE);
}

beforeAll(async () => {
    if (!isObsidianRunning()) {
        throw new Error(
            'Obsidian is not running or CLI is unreachable. ' +
            'Start Obsidian with the Dev vault before running integration tests.',
        );
    }
    await resetFixture();
});

afterAll(async () => {
    deleteTestFile(TEST_FILE);
    await waitForFileDeindexed(TEST_FILE);

    // Clean up archive file if it was created
    const archiveAbs = vaultAbsolute(ARCHIVE_FILE);
    if (fs.existsSync(archiveAbs)) {
        deleteTestFile(ARCHIVE_FILE);
        await waitForFileDeindexed(ARCHIVE_FILE);
    }
});

// ────────────────────────────────────────────
// 1. repeat command
// ────────────────────────────────────────────
describe('repeat command', () => {
    beforeAll(() => resetFixture());

    it('generates a new task with shifted date when completed', async () => {
        const task = findTask('repeat-test-A');
        expect(task).toBeDefined();
        expect(task!.startDate).toBe('2026-04-01');

        cliUpdate({ id: task!.id as string, status: 'x' });

        const newTask = await waitForTask(
            { file: TEST_FILE, outputFields: 'id,content,status,startDate' },
            t => (t.content as string).includes('repeat-test-A')
                && t.status === ' '
                && t.startDate === '2026-04-02',
            8000,
        );

        expect(newTask).not.toBeNull();
        expect(newTask!.startDate).toBe('2026-04-02');
        expect(newTask!.status).toBe(' ');

        // Verify original task is still present and completed
        const completedOriginal = cliList({
            file: TEST_FILE,
            status: 'x',
            content: 'repeat-test-A',
            outputFields: 'id,content,status',
        });
        expect(completedOriginal.count).toBeGreaterThanOrEqual(1);
    }, 20000);

    it('repeat with date range shifts both start and end dates', async () => {
        // Reset to clean state for this test
        await resetFixture();

        const task = findTask('repeat-test-B');
        expect(task).toBeDefined();
        expect(task!.startDate).toBe('2026-04-01');
        expect(task!.endDate).toBe('2026-04-03');

        cliUpdate({ id: task!.id as string, status: 'x' });

        const newTask = await waitForTask(
            { file: TEST_FILE, outputFields: 'id,content,status,startDate,endDate' },
            t => (t.content as string).includes('repeat-test-B')
                && t.status === ' '
                && t.startDate === '2026-04-08',
            8000,
        );

        expect(newTask).not.toBeNull();
        expect(newTask!.startDate).toBe('2026-04-08');
        expect(newTask!.endDate).toBe('2026-04-10');
    }, 20000);
});

// ────────────────────────────────────────────
// 2. next command
// ────────────────────────────────────────────
describe('next command', () => {
    beforeAll(() => resetFixture());

    it('generates a new task without commands when completed', async () => {
        const task = findTask('next-test-A');
        expect(task).toBeDefined();

        cliUpdate({ id: task!.id as string, status: 'x' });

        const newTask = await waitForTask(
            { file: TEST_FILE, outputFields: 'id,content,status,startDate' },
            t => (t.content as string).includes('next-test-A')
                && t.status === ' '
                && t.startDate === '2026-04-04',
            8000,
        );

        expect(newTask).not.toBeNull();
        expect(newTask!.startDate).toBe('2026-04-04');
    }, 20000);
});

// ────────────────────────────────────────────
// 3. move command
// ────────────────────────────────────────────
describe('move command', () => {
    beforeAll(() => resetFixture());

    it('moves task to archive file and deletes original', async () => {
        const task = findTask('move-test-A');
        expect(task).toBeDefined();

        cliUpdate({ id: task!.id as string, status: 'x' });

        const gone = await waitForTaskGone(
            { file: TEST_FILE, outputFields: 'id,content' },
            t => (t.content as string).includes('move-test-A'),
            5000,
        );

        expect(gone).toBe(true);

        // Verify it appeared in archive file
        const archiveResult = cliList({
            file: ARCHIVE_FILE,
            content: 'move-test-A',
            outputFields: 'id,content,status',
        });
        expect(archiveResult.count).toBeGreaterThanOrEqual(1);
    }, 20000);
});
