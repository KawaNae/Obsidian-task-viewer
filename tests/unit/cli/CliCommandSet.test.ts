import { describe, it, expect } from 'vitest';
import { registerCliHandlers } from '../../../src/cli/CliRegistrar';

/**
 * The CLI's command set, pinned by name. `convert` and `create-tv-file` went
 * with the file task: frontmatter makes no task, so there is nothing to
 * convert a line into or to create. A command dropping out, or a stale one
 * coming back, should be a decision someone sees in a diff.
 */
describe('registerCliHandlers', () => {
    it('registers exactly the current commands', () => {
        const names: string[] = [];
        const plugin = {
            registerCliHandler: (name: string) => { names.push(name); },
        };

        registerCliHandlers(plugin as never);

        expect(names.map(n => n.replace('obsidian-task-viewer:', '')).sort()).toEqual([
            'categorized-tasks-for-date-range',
            'create',
            'delete',
            'duplicate',
            'export-image',
            'get',
            'get-start-hour',
            'help',
            'insert-child-task',
            'list',
            'tasks-for-date-range',
            'today',
            'update',
        ]);
    });
});
