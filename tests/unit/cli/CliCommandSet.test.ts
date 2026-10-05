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

describe('the export-image registration', () => {
    function exportImage() {
        const handlers = new Map<string, (params: Record<string, string>) => Promise<string>>();
        const plugin = {
            registerCliHandler: (name: string, _d: string, _f: unknown, handler: (p: Record<string, string>) => Promise<string>) => {
                handlers.set(name.replace('obsidian-task-viewer:', ''), handler);
            },
        };
        registerCliHandlers(plugin as never);
        return handlers.get('export-image')!;
    }

    const errorOf = (out: string) => (JSON.parse(out) as { error: string }).error;

    it("passes the view's own flags to the handler, which checks them", async () => {
        const out = await exportImage()({ view: 'timeline', 'days-to-show': 'abc' });
        expect(errorOf(out)).toMatch(/Invalid days-to-show/);
    });

    it('turns an error the handler throws into a cliError', async () => {
        // No settings on the plugin: reading the template folder throws.
        const out = await exportImage()({ template: 'x' });
        expect(errorOf(out)).toMatch(/viewTemplateFolder|undefined/);
    });
});

