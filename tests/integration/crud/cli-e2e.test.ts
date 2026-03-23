/**
 * CLI E2E Tests
 *
 * These tests call the real Obsidian CLI via PowerShell and assert on JSON responses.
 * Prerequisites:
 *   - Obsidian is running with the Dev vault (C:\Obsidian\Dev) open
 *   - test-tags-properties.md exists in the vault root with the expected test data
 *
 * Run:  npx vitest run tests/e2e/cli-e2e.test.ts
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
    cliList, cliToday, cliGet, cliCreate, cliUpdate, cliDelete,
    isObsidianRunning, obsidianCli,
} from '../helpers/cli-helper';

const TEST_FILE = 'test-tags-properties.md';

beforeAll(() => {
    if (!isObsidianRunning()) {
        throw new Error(
            'Obsidian is not running or CLI is unreachable. ' +
            'Start Obsidian with the Dev vault before running E2E tests.',
        );
    }
});

// ────────────────────────────────────────────
// 1. list — basics
// ────────────────────────────────────────────
describe('list — basics', () => {
    it('returns JSON with count and tasks', () => {
        const r = cliList({ limit: '3' });
        expect(r).toHaveProperty('count');
        expect(r).toHaveProperty('tasks');
        expect(r.count).toBe(3);
        expect(r.tasks).toHaveLength(3);
    });

    it('respects outputFields', () => {
        const r = cliList({ limit: '1', outputFields: 'content,tags' });
        const task = r.tasks[0];
        expect(task).toHaveProperty('id');
        expect(task).toHaveProperty('content');
        expect(task).toHaveProperty('tags');
        expect(task).not.toHaveProperty('startDate');
        expect(task).not.toHaveProperty('properties');
    });

    it('file filter works with .md extension', () => {
        const r = cliList({ file: TEST_FILE });
        expect(r.count).toBe(10);
    });

    it('file filter auto-appends .md', () => {
        const r = cliList({ file: 'test-tags-properties' });
        expect(r.count).toBe(10);
    });
});

// ────────────────────────────────────────────
// 2. list — hierarchical tag filter
// ────────────────────────────────────────────
describe('list — hierarchical tag filter', () => {
    it('parent tag matches all children (tag=支出)', () => {
        const r = cliList({ tag: '支出', file: TEST_FILE });
        expect(r.count).toBe(7);
    });

    it('leaf tag matches only that tag (tag=支出/食費)', () => {
        const r = cliList({ tag: '支出/食費', file: TEST_FILE, outputFields: 'content,tags' });
        expect(r.count).toBe(3);
        for (const t of r.tasks) {
            expect((t.tags as string[]).some(tag => tag === '支出/食費')).toBe(true);
        }
    });

    it('tag=支払/クレカ matches 4 tasks', () => {
        const r = cliList({ tag: '支払/クレカ', file: TEST_FILE });
        expect(r.count).toBe(4);
    });

    it('tag=収入 matches 1 task', () => {
        const r = cliList({ tag: '収入', file: TEST_FILE, outputFields: 'content,tags' });
        expect(r.count).toBe(1);
        expect(r.tasks[0].content).toContain('給与');
    });

    it('tasks without matching tags are excluded', () => {
        const r = cliList({ tag: '支出', file: TEST_FILE, outputFields: 'content,tags' });
        for (const t of r.tasks) {
            const tags = t.tags as string[];
            expect(tags.some(tag => tag.startsWith('支出'))).toBe(true);
        }
    });
});

// ────────────────────────────────────────────
// 3. list — custom property filter
// ────────────────────────────────────────────
describe('list — custom property filter', () => {
    it('property filter: 優先度:高 returns 3 tasks', () => {
        const r = cliList({ property: '優先度:高', file: TEST_FILE });
        expect(r.count).toBe(3);
    });

    it('property filter: 金額:2000 returns 1 task', () => {
        const r = cliList({ property: '金額:2000', file: TEST_FILE });
        expect(r.count).toBe(1);
    });

    it('property filter: 店舗:コンビニ returns 1 task', () => {
        const r = cliList({ property: '店舗:コンビニ', file: TEST_FILE });
        expect(r.count).toBe(1);
    });

    it('properties field is populated correctly', () => {
        const r = cliList({ content: '課金A', outputFields: 'content,properties' });
        expect(r.count).toBe(1);
        const props = r.tasks[0].properties as Record<string, unknown>;
        expect(props['金額']).toBe(2000);
        expect(props['優先度']).toBe('高');
        expect(props['メモ']).toBe('月パス');
    });

    it('tasks with only inherited properties have frontmatter properties', () => {
        const r = cliList({ content: 'タグなしテスト', outputFields: 'content,properties' });
        expect(r.count).toBe(1);
        // タグなしテスト has no inline properties, but inherits frontmatter customProperty
        expect(r.tasks[0].properties).toHaveProperty('customProperty');
    });
});

// ────────────────────────────────────────────
// 4. list — combined filters
// ────────────────────────────────────────────
describe('list — combined filters', () => {
    it('tag + property AND filter', () => {
        const r = cliList({
            tag: '支出/ゲーム',
            property: '優先度:高',
            file: TEST_FILE,
            outputFields: 'content,tags,properties',
        });
        expect(r.count).toBe(3);
        for (const t of r.tasks) {
            expect((t.tags as string[]).some(tag => tag === '支出/ゲーム')).toBe(true);
            expect((t.properties as Record<string, unknown>)['優先度']).toBe('高');
        }
    });
});

// ────────────────────────────────────────────
// 5. list — date, status, content filters
// ────────────────────────────────────────────
describe('list — date, status, content filters', () => {
    it('date filter returns tasks active on that date', () => {
        const r = cliList({ date: '2026-03-16', file: TEST_FILE });
        expect(r.count).toBeGreaterThan(0);
    });

    it('status=x returns 0 (all tasks are unchecked)', () => {
        const r = cliList({ status: 'x', file: TEST_FILE });
        expect(r.count).toBe(0);
    });

    it('content filter with partial match', () => {
        const r = cliList({ content: '課金', file: TEST_FILE, outputFields: 'content' });
        // ゲーム課金テスト, 課金A, 高額課金E = 3 tasks
        expect(r.count).toBe(3);
        for (const t of r.tasks) {
            expect(t.content as string).toContain('課金');
        }
    });
});

// ────────────────────────────────────────────
// 6. today command
// ────────────────────────────────────────────
describe('today', () => {
    it('returns tasks in { count, tasks } format', () => {
        const r = cliToday({ limit: '5', outputFields: 'content' });
        expect(r).toHaveProperty('count');
        expect(r).toHaveProperty('tasks');
        expect(Array.isArray(r.tasks)).toBe(true);
    });
});

// ────────────────────────────────────────────
// 7. get command
// ────────────────────────────────────────────
describe('get', () => {
    it('retrieves a single task by ID', () => {
        const list = cliList({ file: TEST_FILE, limit: '1' });
        const id = list.tasks[0].id as string;

        const task = cliGet(id, { outputFields: 'id,content,file,tags,properties' });
        expect(task.id).toBe(id);
        expect(task).toHaveProperty('content');
        expect(task).toHaveProperty('file');
    });

    it('returns error for nonexistent ID', () => {
        const result = cliGet('nonexistent-id-12345');
        expect(result).toHaveProperty('error');
    });
});

// ────────────────────────────────────────────
// 8. CRUD — create → get → update → delete
// ────────────────────────────────────────────
describe('CRUD lifecycle', () => {
    let createdId: string;

    it('create — creates a new task', () => {
        const r = cliCreate({
            file: TEST_FILE,
            content: 'E2E-test-task',
            start: '2026-04-01',
            outputFields: 'id,content,startDate',
        });
        expect(r).not.toHaveProperty('error');
        expect(r.task.content).toContain('E2E-test-task');
        expect(r.task.startDate).toBe('2026-04-01');
        createdId = r.task.id as string;
        expect(createdId).toBeTruthy();
    });

    it('get — retrieves the created task', () => {
        const task = cliGet(createdId, { outputFields: 'id,content,startDate' });
        expect(task.id).toBe(createdId);
        expect(task.content).toContain('E2E-test-task');
        expect(task.startDate).toBe('2026-04-01');
    });

    it('update — modifies content and status', () => {
        // Re-fetch ID in case it changed after create (line number shift)
        const fresh = cliList({ content: 'E2E-test-task', outputFields: 'id' });
        if (fresh.count > 0) createdId = fresh.tasks[0].id as string;

        const r = cliUpdate({
            id: createdId,
            content: 'E2E-updated',
            status: 'x',
            outputFields: 'id,content,status',
        });
        expect(r).not.toHaveProperty('error');
        expect(r.task.content).toContain('E2E-updated');
        expect(r.task.status).toBe('x');
        // Update createdId for delete step
        createdId = r.task.id as string;
    });

    it('delete — removes the task', () => {
        // Re-fetch ID in case it changed after update
        const fresh = cliList({ content: 'E2E-updated', outputFields: 'id' });
        if (fresh.count > 0) createdId = fresh.tasks[0].id as string;

        const r = cliDelete(createdId);
        expect(r).not.toHaveProperty('error');
        expect(r.deleted).toBe(createdId);
    });

    it('get after delete — returns error', () => {
        const result = cliGet(createdId);
        expect(result).toHaveProperty('error');
    });
});

// ────────────────────────────────────────────
// 9. Error cases
// ────────────────────────────────────────────
describe('error cases', () => {
    it('create without file returns error', () => {
        const r = obsidianCli('create', { content: 'test' }) as Record<string, unknown>;
        expect(r).toHaveProperty('error');
    });

    it('update without id returns error', () => {
        const r = obsidianCli('update', { content: 'test' }) as Record<string, unknown>;
        expect(r).toHaveProperty('error');
    });

    it('invalid date returns error', () => {
        const r = obsidianCli('list', { date: 'invalid' }) as Record<string, unknown>;
        expect(r).toHaveProperty('error');
    });

    it('invalid outputFields returns error', () => {
        const r = obsidianCli('list', { outputFields: 'nonexistent', limit: '1' }) as Record<string, unknown>;
        expect(r).toHaveProperty('error');
    });
});
