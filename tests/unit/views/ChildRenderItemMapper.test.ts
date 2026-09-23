import { describe, it, expect } from 'vitest';
import { FileParsePipeline } from '../../../src/services/parsing/FileParsePipeline';
import { buildChildEntries } from '../../../src/services/data/ChildEntryBuilder';
import { ChildRenderItemMapper } from '../../../src/views/taskcard/ChildRenderItemMapper';
import { DEFAULT_SETTINGS, type Task } from '../../../src/types';

/**
 * What a card draws for the lines under a task that are not tasks.
 *
 * Every checkbox is a task, so a child line is never a checkbox. The one place
 * a `- [ ]` still reaches the child lines is inside a code fence, where it is an
 * example: it used to be drawn as a clickable checkbox and counted towards the
 * card's n/m, and a click rewrote the example. It is now drawn as it is written.
 */

function childItems(lines: string[]) {
    const { tasks } = FileParsePipeline.parse('note.md', lines, DEFAULT_SETTINGS);
    const byId = new Map(tasks.map(task => [task.id, task]));
    const parent = tasks[0];
    const entries = buildChildEntries(parent, id => byId.get(id) as Task | undefined);
    const mapper = new ChildRenderItemMapper();
    return { tasks, entries, items: entries.filter(e => e.kind === 'line').map(e => e.kind === 'line' ? mapper.createPlainItem(e.line, '') : null!) };
}

describe('child lines on a card', () => {
    it('draws a fenced `- [ ]` as an inert line, not a checkbox', () => {
        const { tasks, items } = childItems([
            '- [ ] 手順 @2026-09-21',
            '    ```markdown',
            '    - [ ] 例',
            '    ```',
        ]);
        expect(tasks).toHaveLength(1);
        const example = items.find(item => item.markdown.includes('- [ ] 例'))!;
        expect(example.isCheckbox).toBe(false);
        expect(example.handler).toBeNull();
        expect(items.every(item => !item.isCheckbox)).toBe(true);
    });

    it('draws a `- [[note]]` child as an ordinary link line', () => {
        const { entries, items } = childItems([
            '- [ ] 束ね @2026-09-21',
            '    - [[他のノート]]',
        ]);
        expect(entries.map(e => e.kind)).toEqual(['line']);
        expect(items[0].markdown).toBe('- [[他のノート]]');
        expect(items[0].isCheckbox).toBe(false);
    });
});
