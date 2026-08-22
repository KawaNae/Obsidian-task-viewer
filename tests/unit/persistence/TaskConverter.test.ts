import { describe, it, expect } from 'vitest';
import { TaskConverter } from '../../../src/services/persistence/TaskConverter';
import { makeTask } from '../helpers/makeTask';
import type { PropertyValue, Task } from '../../../src/types';

const pv = (value: string, type: PropertyValue['type'] = 'string'): PropertyValue => ({ value, type });

/** Captures what convertToTvFile writes, without a vault. */
function converterOnto(created: { path?: string; content?: string }) {
    const app = {
        vault: {
            create: async (path: string, content: string) => {
                created.path = path;
                created.content = content;
            },
            getAbstractFileByPath: () => null,
        },
        fileManager: { getNewFileParent: () => ({ path: '' }) },
    } as any;
    return new TaskConverter(app, {} as any);
}

async function frontmatterOf(task: Task): Promise<string[]> {
    const created: { content?: string } = {};
    await converterOnto(created).convertToTvFile(task, 'Children', 2);
    const lines = (created.content ?? '').split('\n');
    return lines.slice(1, lines.indexOf('---', 1));
}

describe('TaskConverter.convertToTvFile frontmatter', () => {
    it('writes the task fields', async () => {
        const fm = await frontmatterOf(makeTask({
            content: 'real content',
            startDate: '2026-08-22',
            startTime: '10:00',
        }));
        expect(fm).toEqual(['tv-start: 2026-08-22T10:00', 'tv-content: real content']);
    });

    it('writes custom properties', async () => {
        const fm = await frontmatterOf(makeTask({
            content: 'real content',
            properties: { 'project': pv('alpha'), '金額': pv('2000', 'number') },
        }));
        expect(fm).toContain('project: alpha');
        expect(fm).toContain('金額: 2000');
    });

    // A reserved key reaching this writer used to be printed verbatim after
    // the task's own line for the same key. YAML takes the last one, so the
    // converted file's content was whatever the stray property said — and
    // `tv-ignore` made the file the conversion had just created invisible to
    // the plugin, so the task vanished from every view.
    it('does not emit a reserved key carried in properties', async () => {
        const fm = await frontmatterOf(makeTask({
            content: 'real content',
            properties: {
                'tv-content': pv('hijack'),
                'tv-ignore': pv('true'),
                'tv-status': pv('x'),
                'project': pv('alpha'),
            },
        }));
        expect(fm).toEqual(['tv-content: real content', 'project: alpha']);
    });

    it('does not emit a reserved key carried in the section cascade', async () => {
        const fm = await frontmatterOf(makeTask({
            content: 'real content',
            cascadeContext: { properties: { 'tv-ignore': pv('true') } },
        } as Partial<Task>));
        expect(fm.some(line => line.startsWith('tv-ignore'))).toBe(false);
    });

    it('never writes the same key twice', async () => {
        const fm = await frontmatterOf(makeTask({
            content: 'real content',
            statusChar: 'x',
            startDate: '2026-08-22',
            properties: { 'tv-content': pv('a'), 'tv-status': pv('b'), 'tv-start': pv('c') },
        }));
        const keys = fm.map(line => line.slice(0, line.indexOf(':')));
        expect(new Set(keys).size).toBe(keys.length);
    });
});
