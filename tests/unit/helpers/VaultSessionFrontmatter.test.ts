import { describe, it, expect } from 'vitest';
import { vaultSession } from './vaultSession';

/**
 * The frontmatter-reading gap `structure.md` names as a scaffold limit
 * (`vaultSession` used to answer `metadataCache.getCache` with `null` always).
 *
 * `tv-color` is the cascade this exercises: `FilePropertyResolver.extract`
 * reads it from frontmatter, `SectionPropertyResolver` carries it down with
 * nothing to override it, and `TreeTaskExtractor` puts it on
 * `Task.cascadeContext.color` because the task's own lines declare none
 * (`TreeTaskExtractor.ts:184-195`). A task with its own `tv-color` line
 * would win instead — this scenario is about the frontmatter path reaching
 * a task at all, not about the merge order.
 */
describe('vaultSession: reading frontmatter through metadataCache', () => {
    it('cascades tv-color from frontmatter onto a task with none of its own', async () => {
        const FILE = 'note.md';
        const contents = new Map([[FILE, [
            '---',
            'tv-color: ff0000',
            '---',
            '- [ ] タスク @2026-09-21',
            '',
        ].join('\n')]]);
        const session = vaultSession(contents);
        await session.scanAll();

        const task = session.index.getTasks().find(t => t.content === 'タスク')!;
        expect(task.cascadeContext?.color).toBe('ff0000');
        expect(task.color).toBeUndefined();
    });

    it('leaves a task alone when it declares its own tv-color', async () => {
        const FILE = 'note.md';
        const contents = new Map([[FILE, [
            '---',
            'tv-color: ff0000',
            '---',
            '- [ ] タスク @2026-09-21',
            '    - tv-color:: 00ff00',
            '',
        ].join('\n')]]);
        const session = vaultSession(contents);
        await session.scanAll();

        const task = session.index.getTasks().find(t => t.content === 'タスク')!;
        expect(task.color).toBe('00ff00');
    });

    /**
     * `FileParsePipeline` falls back to parsing the raw `---` block itself
     * when `cachedFrontmatter` is undefined (`FileParsePipeline.ts:44-58`),
     * so the cascade test above would pass even with `getCache` answering
     * `null` again — the fallback would carry it. This one calls
     * `metadataCache.getCache` directly, the way `TaskScanner` does
     * (`TaskScanner.ts:68,132,209`), so it fails on that mutation alone.
     */
    it('answers metadataCache.getCache with the frontmatter directly, not only through the fallback', async () => {
        const FILE = 'note.md';
        const contents = new Map([[FILE, [
            '---',
            'tv-color: ff0000',
            '---',
            '- [ ] タスク @2026-09-21',
            '',
        ].join('\n')]]);
        const session = vaultSession(contents);
        const app = (session.index as unknown as {
            app: { metadataCache: { getCache: (path: string) => { frontmatter?: Record<string, unknown> } | null } };
        }).app;

        expect(app.metadataCache.getCache(FILE)?.frontmatter?.['tv-color']).toBe('ff0000');
    });
});
