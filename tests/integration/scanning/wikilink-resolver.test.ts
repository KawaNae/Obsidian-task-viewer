/**
 * WikiLinkResolver Integration Tests
 *
 * These tests verify wikilink parent-child resolution via the real Obsidian CLI,
 * replacing the InMemoryVault-based mock tests.
 *
 * Prerequisites:
 *   - Obsidian is running with the Dev vault (C:\Obsidian\Dev) open
 *
 * Run:  npx vitest run tests/integration/scanning/wikilink-resolver.test.ts
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
    cliList, cliGet, isObsidianRunning, sleep,
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
// 1. Frontmatter wikilink refs: parent → child
// ────────────────────────────────────────────
describe('frontmatter wikilink resolution', () => {
    const PARENT_FILE = 'test-int-wikilink-parent.md';
    const CHILD_FILE = 'test-int-wikilink-child.md';

    const parentFixture = createFixture(PARENT_FILE, [
        '---',
        'tv-start: 2026-05-01',
        'tv-content: Parent Project',
        '---',
        '## Tasks',
        '- [[test-int-wikilink-child]]',
    ].join('\n'));

    const childFixture = createFixture(CHILD_FILE, [
        '---',
        'tv-start: 2026-05-02',
        'tv-content: Child Task',
        '---',
        'Child body.',
    ].join('\n'));

    beforeAll(async () => {
        // Create child first so it exists when parent is scanned
        await childFixture.setup();
        await parentFixture.setup();
        // Extra wait for wikilink resolution to settle
        await sleep(5000);
    });

    afterAll(async () => {
        await parentFixture.teardown();
        await childFixture.teardown();
    });

    it('resolves wikilink ref to existing file (parent → child)', () => {
        const parentResult = cliList({ file: PARENT_FILE, outputFields: OUTPUT_FIELDS });
        const parentTask = parentResult.tasks.find(t => t.parserId === 'frontmatter');
        expect(parentTask).toBeDefined();

        const childResult = cliList({ file: CHILD_FILE, outputFields: OUTPUT_FIELDS });
        const childTask = childResult.tasks.find(t => t.parserId === 'frontmatter');
        expect(childTask).toBeDefined();

        // Parent should have child in childIds
        const childIds = (parentTask!.childIds as string[]) ?? [];
        expect(childIds).toContain(childTask!.id);
        // Child should have parentId pointing to parent
        expect(childTask!.parentId).toBe(parentTask!.id);
    });
});

// ────────────────────────────────────────────
// 2. Resolves with .md extension in wikilink target
// ────────────────────────────────────────────
describe('wikilink with .md extension', () => {
    const PARENT_FILE = 'test-int-wikilink-mdext-parent.md';
    const CHILD_FILE = 'test-int-wikilink-mdext-child.md';

    const parentFixture = createFixture(PARENT_FILE, [
        '---',
        'tv-start: 2026-05-01',
        'tv-content: Parent MdExt',
        '---',
        '## Tasks',
        '- [[test-int-wikilink-mdext-child.md]]',
    ].join('\n'));

    const childFixture = createFixture(CHILD_FILE, [
        '---',
        'tv-start: 2026-05-02',
        'tv-content: Child MdExt',
        '---',
        'Body.',
    ].join('\n'));

    beforeAll(async () => {
        await childFixture.setup();
        await parentFixture.setup();
        await sleep(5000);
    });

    afterAll(async () => {
        await parentFixture.teardown();
        await childFixture.teardown();
    });

    it('resolves wikilink target that includes .md extension', () => {
        const parentResult = cliList({ file: PARENT_FILE, outputFields: OUTPUT_FIELDS });
        const parentTask = parentResult.tasks.find(t => t.parserId === 'frontmatter');

        const childResult = cliList({ file: CHILD_FILE, outputFields: OUTPUT_FIELDS });
        const childTask = childResult.tasks.find(t => t.parserId === 'frontmatter');

        expect(parentTask).toBeDefined();
        expect(childTask).toBeDefined();

        const childIds = (parentTask!.childIds as string[]) ?? [];
        expect(childIds).toContain(childTask!.id);
    });
});

// ────────────────────────────────────────────
// 3. Skips unresolvable wikilink target
// ────────────────────────────────────────────
describe('unresolvable wikilink', () => {
    const FILE = 'test-int-wikilink-unresolvable.md';

    const fixture = createFixture(FILE, [
        '---',
        'tv-start: 2026-05-01',
        'tv-content: Unresolvable Parent',
        '---',
        '## Tasks',
        '- [[nonexistent-file-xyz-12345]]',
    ].join('\n'));

    beforeAll(() => fixture.setup());
    afterAll(() => fixture.teardown());

    it('does not add unresolvable target to childIds', () => {
        const r = cliList({ file: FILE, outputFields: OUTPUT_FIELDS });
        const task = r.tasks.find(t => t.parserId === 'frontmatter');
        expect(task).toBeDefined();
        const childIds = (task!.childIds as string[]) ?? [];
        expect(childIds).toHaveLength(0);
    });
});

// ────────────────────────────────────────────
// 4. Prevents self-link
// ────────────────────────────────────────────
describe('self-link prevention', () => {
    const FILE = 'test-int-wikilink-selflink.md';

    const fixture = createFixture(FILE, [
        '---',
        'tv-start: 2026-05-01',
        'tv-content: Self Linker',
        '---',
        '## Tasks',
        '- [[test-int-wikilink-selflink]]',
    ].join('\n'));

    beforeAll(() => fixture.setup());
    afterAll(() => fixture.teardown());

    it('does not resolve self-link', () => {
        const r = cliList({ file: FILE, outputFields: OUTPUT_FIELDS });
        const task = r.tasks.find(t => t.parserId === 'frontmatter');
        expect(task).toBeDefined();
        const childIds = (task!.childIds as string[]) ?? [];
        // Should not contain its own id
        expect(childIds).not.toContain(task!.id);
        // parentId should not be set (CLI may return undefined, null, or omit the field)
        expect(task!.parentId).toBeFalsy();
    });
});

// ────────────────────────────────────────────
// 5. Inline childLine wikilink resolution
// ────────────────────────────────────────────
describe('inline childLine wikilinks', () => {
    const PARENT_FILE = 'test-int-wikilink-inline-parent.md';
    const CHILD_FILE = 'test-int-wikilink-inline-child.md';

    const childFixture = createFixture(CHILD_FILE, [
        '---',
        'tv-start: 2026-05-10',
        'tv-content: Inline Child',
        '---',
        'Child body.',
    ].join('\n'));

    const parentFixture = createFixture(PARENT_FILE, [
        '- [ ] Inline parent @2026-05-09',
        '\t- [[test-int-wikilink-inline-child]]',
    ].join('\n'));

    beforeAll(async () => {
        await childFixture.setup();
        await parentFixture.setup();
        await sleep(5000);
    });

    afterAll(async () => {
        await parentFixture.teardown();
        await childFixture.teardown();
    });

    it('resolves wikilink from inline task childLines', () => {
        const parentResult = cliList({ file: PARENT_FILE, outputFields: OUTPUT_FIELDS });
        const parentTask = parentResult.tasks.find(t => t.content === 'Inline parent');

        const childResult = cliList({ file: CHILD_FILE, outputFields: OUTPUT_FIELDS });
        const childTask = childResult.tasks.find(t => t.parserId === 'frontmatter');

        expect(parentTask).toBeDefined();
        expect(childTask).toBeDefined();

        const childIds = (parentTask!.childIds as string[]) ?? [];
        expect(childIds).toContain(childTask!.id);
        expect(childTask!.parentId).toBe(parentTask!.id);
    });
});

// ────────────────────────────────────────────
// 6. Ignores non-wikilink childLines
// ────────────────────────────────────────────
describe('non-wikilink childLines', () => {
    const FILE = 'test-int-wikilink-nonwiki.md';

    const fixture = createFixture(FILE, [
        '- [ ] Parent with plain children @2026-05-09',
        '\t- plain text child',
        '\t- [ ] checkbox child',
    ].join('\n'));

    beforeAll(() => fixture.setup());
    afterAll(() => fixture.teardown());

    it('does not create wikilink-based childIds for non-wikilink childLines', () => {
        const r = cliList({ file: FILE, outputFields: OUTPUT_FIELDS });
        const parent = r.tasks.find(t => t.content === 'Parent with plain children');
        expect(parent).toBeDefined();
        // The checkbox child may appear as a separate @notation task with parentId,
        // but no wikilink resolution should have added frontmatter tasks as children
        const childIds = (parent!.childIds as string[]) ?? [];
        // Should only contain the checkbox child (nested @notation), not any wikilink-resolved tasks
        for (const cid of childIds) {
            const child = cliGet(cid, { outputFields: 'parserId,content' });
            // Any childId should be from inline parsing, not wikilink resolution
            expect(child.parserId).toBe('at-notation');
        }
    });
});

// ────────────────────────────────────────────
// 7. Pipe alias stripped from wikilink target
// ────────────────────────────────────────────
describe('pipe alias handling', () => {
    const PARENT_FILE = 'test-int-wikilink-alias-parent.md';
    const CHILD_FILE = 'test-int-wikilink-alias-child.md';

    const childFixture = createFixture(CHILD_FILE, [
        '---',
        'tv-start: 2026-05-20',
        'tv-content: Aliased Child',
        '---',
        'Body.',
    ].join('\n'));

    const parentFixture = createFixture(PARENT_FILE, [
        '---',
        'tv-start: 2026-05-19',
        'tv-content: Alias Parent',
        '---',
        '## Tasks',
        '- [[test-int-wikilink-alias-child|Display Name]]',
    ].join('\n'));

    beforeAll(async () => {
        await childFixture.setup();
        await parentFixture.setup();
        await sleep(5000);
    });

    afterAll(async () => {
        await parentFixture.teardown();
        await childFixture.teardown();
    });

    it('strips pipe alias from wikilink target and resolves correctly', () => {
        const parentResult = cliList({ file: PARENT_FILE, outputFields: OUTPUT_FIELDS });
        const parentTask = parentResult.tasks.find(t => t.parserId === 'frontmatter');

        const childResult = cliList({ file: CHILD_FILE, outputFields: OUTPUT_FIELDS });
        const childTask = childResult.tasks.find(t => t.parserId === 'frontmatter');

        expect(parentTask).toBeDefined();
        expect(childTask).toBeDefined();

        const childIds = (parentTask!.childIds as string[]) ?? [];
        expect(childIds).toContain(childTask!.id);
    });
});

// ────────────────────────────────────────────
// 8. childIds sorted by bodyLine
// ────────────────────────────────────────────
describe('childIds ordering', () => {
    const PARENT_FILE = 'test-int-wikilink-order-parent.md';
    const CHILD1_FILE = 'test-int-wikilink-order-c1.md';
    const CHILD2_FILE = 'test-int-wikilink-order-c2.md';
    const CHILD3_FILE = 'test-int-wikilink-order-c3.md';

    const c1Fixture = createFixture(CHILD1_FILE, [
        '---',
        'tv-start: 2026-06-01',
        'tv-content: Child One',
        '---',
    ].join('\n'));

    const c2Fixture = createFixture(CHILD2_FILE, [
        '---',
        'tv-start: 2026-06-02',
        'tv-content: Child Two',
        '---',
    ].join('\n'));

    const c3Fixture = createFixture(CHILD3_FILE, [
        '---',
        'tv-start: 2026-06-03',
        'tv-content: Child Three',
        '---',
    ].join('\n'));

    // Parent lists children in order: c1, c2, c3 (by body line position)
    const parentFixture = createFixture(PARENT_FILE, [
        '---',
        'tv-start: 2026-06-01',
        'tv-content: Order Parent',
        '---',
        '## Tasks',
        '- [[test-int-wikilink-order-c1]]',
        '- [[test-int-wikilink-order-c2]]',
        '- [[test-int-wikilink-order-c3]]',
    ].join('\n'));

    beforeAll(async () => {
        await c1Fixture.setup();
        await c2Fixture.setup();
        await c3Fixture.setup();
        await parentFixture.setup();
        await sleep(5000);
    });

    afterAll(async () => {
        await parentFixture.teardown();
        await c3Fixture.teardown();
        await c2Fixture.teardown();
        await c1Fixture.teardown();
    });

    it('sorts childIds by bodyLine order', () => {
        const parentResult = cliList({ file: PARENT_FILE, outputFields: OUTPUT_FIELDS });
        const parentTask = parentResult.tasks.find(t => t.parserId === 'frontmatter');
        expect(parentTask).toBeDefined();

        const c1Result = cliList({ file: CHILD1_FILE, outputFields: OUTPUT_FIELDS });
        const c1 = c1Result.tasks.find(t => t.parserId === 'frontmatter');
        const c2Result = cliList({ file: CHILD2_FILE, outputFields: OUTPUT_FIELDS });
        const c2 = c2Result.tasks.find(t => t.parserId === 'frontmatter');
        const c3Result = cliList({ file: CHILD3_FILE, outputFields: OUTPUT_FIELDS });
        const c3 = c3Result.tasks.find(t => t.parserId === 'frontmatter');

        expect(c1).toBeDefined();
        expect(c2).toBeDefined();
        expect(c3).toBeDefined();

        const childIds = (parentTask!.childIds as string[]) ?? [];
        expect(childIds).toHaveLength(3);

        // Order should match the bodyLine order in the parent file: c1, c2, c3
        const c1Index = childIds.indexOf(c1!.id as string);
        const c2Index = childIds.indexOf(c2!.id as string);
        const c3Index = childIds.indexOf(c3!.id as string);

        expect(c1Index).toBeLessThan(c2Index);
        expect(c2Index).toBeLessThan(c3Index);
    });
});

// ────────────────────────────────────────────
// 9. Only resolves direct children (min indent)
// ────────────────────────────────────────────
describe('direct children only (indent filtering)', () => {
    const PARENT_FILE = 'test-int-wikilink-indent-parent.md';
    const CHILD_FILE = 'test-int-wikilink-indent-child.md';
    const GRANDCHILD_FILE = 'test-int-wikilink-indent-grandchild.md';

    const childFixture = createFixture(CHILD_FILE, [
        '---',
        'tv-start: 2026-05-15',
        'tv-content: Direct Child',
        '---',
    ].join('\n'));

    const grandchildFixture = createFixture(GRANDCHILD_FILE, [
        '---',
        'tv-start: 2026-05-16',
        'tv-content: Grandchild',
        '---',
    ].join('\n'));

    const parentFixture = createFixture(PARENT_FILE, [
        '- [ ] Indent parent @2026-05-14',
        '\t- [[test-int-wikilink-indent-child]]',
        '\t\t- [[test-int-wikilink-indent-grandchild]]',
    ].join('\n'));

    beforeAll(async () => {
        await childFixture.setup();
        await grandchildFixture.setup();
        await parentFixture.setup();
        await sleep(5000);
    });

    afterAll(async () => {
        await parentFixture.teardown();
        await grandchildFixture.teardown();
        await childFixture.teardown();
    });

    it('only resolves direct children at minimum indent level', () => {
        const parentResult = cliList({ file: PARENT_FILE, outputFields: OUTPUT_FIELDS });
        const parentTask = parentResult.tasks.find(t => t.content === 'Indent parent');
        expect(parentTask).toBeDefined();

        const childResult = cliList({ file: CHILD_FILE, outputFields: OUTPUT_FIELDS });
        const childTask = childResult.tasks.find(t => t.parserId === 'frontmatter');

        const grandchildResult = cliList({ file: GRANDCHILD_FILE, outputFields: OUTPUT_FIELDS });
        const grandchildTask = grandchildResult.tasks.find(t => t.parserId === 'frontmatter');

        expect(childTask).toBeDefined();
        expect(grandchildTask).toBeDefined();

        const childIds = (parentTask!.childIds as string[]) ?? [];
        // Direct child should be resolved
        expect(childIds).toContain(childTask!.id);
        // Grandchild (deeper indent) should NOT be resolved as direct child of parent
        expect(childIds).not.toContain(grandchildTask!.id);
    });
});
