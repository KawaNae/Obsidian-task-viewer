import { describe, it, expect } from 'vitest';
import { WikiLinkResolver } from '../../src/services/core/WikiLinkResolver';
import type { Task, WikilinkRef, ChildLine } from '../../src/types';
import { createInMemoryVault, createFakeApp } from '../helpers/fakeApp';
import { TaskIdGenerator } from '../../src/services/display/TaskIdGenerator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTask(overrides: Partial<Task> = {}): Task {
    return {
        id: overrides.id ?? 'at-notation:file.md:ln:1',
        file: overrides.file ?? 'file.md',
        line: overrides.line ?? 0,
        content: overrides.content ?? 'Test task',
        statusChar: overrides.statusChar ?? ' ',
        indent: 0,
        childIds: [],
        childLines: [],
        childLineBodyOffsets: [],
        originalText: overrides.originalText ?? '- [ ] Test task',
        tags: [],
        parserId: overrides.parserId ?? 'at-notation',
        ...overrides,
    };
}

function makeFmTask(filePath: string, overrides: Partial<Task> = {}): Task {
    const id = TaskIdGenerator.generate('frontmatter', filePath, 'fm-root');
    return makeTask({
        id,
        file: filePath,
        line: -1,
        parserId: 'frontmatter',
        content: filePath.replace(/\.md$/, ''),
        ...overrides,
    });
}

function makeChildLine(text: string): ChildLine {
    const indent = text.match(/^(\s*)/)?.[1] ?? '';
    const wikiMatch = text.match(/^\s*-\s+\[\[([^\]]+)\]\]\s*$/);
    const cbMatch = text.match(/^\s*(?:[-*+]|\d+[.)])\s*\[(.)\]/);
    return {
        text,
        indent,
        checkboxChar: cbMatch ? cbMatch[1] : null,
        wikilinkTarget: wikiMatch ? wikiMatch[1].split('|')[0].trim() : null,
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WikiLinkResolver', () => {
    /**
     * Build a standard fake app with the given file paths registered.
     */
    function setup(filePaths: string[]) {
        const fileContents: Record<string, string> = {};
        for (const p of filePaths) fileContents[p] = '';
        const vault = createInMemoryVault(fileContents);
        const app = createFakeApp(vault);
        return app;
    }

    // ── Frontmatter wikilink refs ──

    describe('frontmatter wikilink refs', () => {
        it('resolves wikilink ref to existing file', () => {
            const app = setup(['parent.md', 'child.md']);
            const parent = makeFmTask('parent.md');
            const child = makeFmTask('child.md');
            const tasks = new Map<string, Task>([
                [parent.id, parent],
                [child.id, child],
            ]);
            const refs = new Map<string, WikilinkRef[]>([
                [parent.id, [{ target: 'child', bodyLine: 5 }]],
            ]);

            WikiLinkResolver.resolve(tasks, refs, app as any);

            expect(parent.childIds).toContain(child.id);
            expect(child.parentId).toBe(parent.id);
        });

        it('resolves with .md extension in target', () => {
            const app = setup(['parent.md', 'child.md']);
            const parent = makeFmTask('parent.md');
            const child = makeFmTask('child.md');
            const tasks = new Map<string, Task>([[parent.id, parent], [child.id, child]]);
            const refs = new Map<string, WikilinkRef[]>([
                [parent.id, [{ target: 'child.md', bodyLine: 5 }]],
            ]);

            WikiLinkResolver.resolve(tasks, refs, app as any);

            expect(parent.childIds).toContain(child.id);
        });

        it('skips unresolvable wikilink target', () => {
            const app = setup(['parent.md']);
            const parent = makeFmTask('parent.md');
            const tasks = new Map<string, Task>([[parent.id, parent]]);
            const refs = new Map<string, WikilinkRef[]>([
                [parent.id, [{ target: 'nonexistent', bodyLine: 5 }]],
            ]);

            WikiLinkResolver.resolve(tasks, refs, app as any);

            expect(parent.childIds).toHaveLength(0);
        });

        it('prevents self-link', () => {
            const app = setup(['self.md']);
            const task = makeFmTask('self.md');
            const tasks = new Map<string, Task>([[task.id, task]]);
            const refs = new Map<string, WikilinkRef[]>([
                [task.id, [{ target: 'self', bodyLine: 5 }]],
            ]);

            WikiLinkResolver.resolve(tasks, refs, app as any);

            expect(task.childIds).toHaveLength(0);
            expect(task.parentId).toBeUndefined();
        });

        it('prevents cycle (A→B→A)', () => {
            const app = setup(['a.md', 'b.md']);
            const a = makeFmTask('a.md');
            const b = makeFmTask('b.md');
            // Pre-wire b→a
            b.childIds = [a.id];
            a.parentId = b.id;

            const tasks = new Map<string, Task>([[a.id, a], [b.id, b]]);
            // Now try a→b (would create cycle)
            const refs = new Map<string, WikilinkRef[]>([
                [a.id, [{ target: 'b', bodyLine: 5 }]],
            ]);

            WikiLinkResolver.resolve(tasks, refs, app as any);

            // a should NOT get b as child (cycle)
            expect(a.childIds).not.toContain(b.id);
        });

        it('first-parent-wins (two parents claim same child)', () => {
            const app = setup(['p1.md', 'p2.md', 'child.md']);
            const p1 = makeFmTask('p1.md');
            const p2 = makeFmTask('p2.md');
            const child = makeFmTask('child.md');
            const tasks = new Map<string, Task>([
                [p1.id, p1], [p2.id, p2], [child.id, child],
            ]);
            const refs = new Map<string, WikilinkRef[]>([
                [p1.id, [{ target: 'child', bodyLine: 3 }]],
                [p2.id, [{ target: 'child', bodyLine: 5 }]],
            ]);

            WikiLinkResolver.resolve(tasks, refs, app as any);

            // Both parents add child to their childIds
            expect(p1.childIds).toContain(child.id);
            expect(p2.childIds).toContain(child.id);
            // But child.parentId is first parent only
            expect(child.parentId).toBe(p1.id);
        });

        it('sorts childIds by bodyLine for frontmatter tasks', () => {
            const app = setup(['parent.md', 'c1.md', 'c2.md', 'c3.md']);
            const parent = makeFmTask('parent.md');
            const c1 = makeFmTask('c1.md');
            const c2 = makeFmTask('c2.md');
            const c3 = makeFmTask('c3.md');
            const tasks = new Map<string, Task>([
                [parent.id, parent], [c1.id, c1], [c2.id, c2], [c3.id, c3],
            ]);
            const refs = new Map<string, WikilinkRef[]>([
                [parent.id, [
                    { target: 'c3', bodyLine: 10 },
                    { target: 'c1', bodyLine: 3 },
                    { target: 'c2', bodyLine: 7 },
                ]],
            ]);

            WikiLinkResolver.resolve(tasks, refs, app as any);

            expect(parent.childIds).toEqual([c1.id, c2.id, c3.id]);
        });
    });

    // ── Inline wikilink childLines ──

    describe('inline childLine wikilinks', () => {
        it('resolves wikilink from childLines', () => {
            const app = setup(['parent.md', 'child.md']);
            const child = makeFmTask('child.md');
            const parent = makeTask({
                id: 'at-notation:parent.md:ln:1',
                file: 'parent.md',
                childLines: [makeChildLine('  - [[child]]')],
            });
            const tasks = new Map<string, Task>([[parent.id, parent], [child.id, child]]);

            WikiLinkResolver.resolve(tasks, new Map(), app as any);

            expect(parent.childIds).toContain(child.id);
            expect(child.parentId).toBe(parent.id);
        });

        it('only resolves direct children (min indent level)', () => {
            const app = setup(['parent.md', 'child.md', 'grandchild.md']);
            const child = makeFmTask('child.md');
            const grandchild = makeFmTask('grandchild.md');
            const parent = makeTask({
                id: 'at-notation:parent.md:ln:1',
                file: 'parent.md',
                childLines: [
                    makeChildLine('  - [[child]]'),
                    makeChildLine('    - [[grandchild]]'),
                ],
            });
            const tasks = new Map<string, Task>([
                [parent.id, parent], [child.id, child], [grandchild.id, grandchild],
            ]);

            WikiLinkResolver.resolve(tasks, new Map(), app as any);

            expect(parent.childIds).toContain(child.id);
            // grandchild is deeper indent → not resolved as direct child
            expect(parent.childIds).not.toContain(grandchild.id);
        });

        it('ignores non-wikilink childLines', () => {
            const app = setup(['parent.md']);
            const parent = makeTask({
                id: 'at-notation:parent.md:ln:1',
                file: 'parent.md',
                childLines: [
                    makeChildLine('  - plain text'),
                    makeChildLine('  - [ ] checkbox child'),
                ],
            });
            const tasks = new Map<string, Task>([[parent.id, parent]]);

            WikiLinkResolver.resolve(tasks, new Map(), app as any);

            expect(parent.childIds).toHaveLength(0);
        });
    });

    // ── basename resolution ──

    describe('basename resolution', () => {
        it('resolves by basename when full path does not match', () => {
            const app = setup(['subfolder/deep/child.md', 'parent.md']);
            const parent = makeFmTask('parent.md');
            const child = makeFmTask('subfolder/deep/child.md');
            const tasks = new Map<string, Task>([[parent.id, parent], [child.id, child]]);
            const refs = new Map<string, WikilinkRef[]>([
                [parent.id, [{ target: 'child', bodyLine: 5 }]],
            ]);

            WikiLinkResolver.resolve(tasks, refs, app as any);

            expect(parent.childIds).toContain(child.id);
        });
    });

    // ── Pipe alias in wikilink target ──

    describe('pipe alias handling', () => {
        it('strips display alias from target', () => {
            const app = setup(['parent.md', 'child.md']);
            const parent = makeFmTask('parent.md');
            const child = makeFmTask('child.md');
            const tasks = new Map<string, Task>([[parent.id, parent], [child.id, child]]);
            const refs = new Map<string, WikilinkRef[]>([
                [parent.id, [{ target: 'child|Display Name', bodyLine: 5 }]],
            ]);

            WikiLinkResolver.resolve(tasks, refs, app as any);

            expect(parent.childIds).toContain(child.id);
        });
    });
});
