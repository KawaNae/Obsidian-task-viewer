import { describe, it, expect } from 'vitest';
import { FileParsePipeline } from '../../../src/services/parsing/FileParsePipeline';
import { namesOutsideIndex } from '../../../src/services/core/RowNames';
import { DEFAULT_SCOPE_KEYS, DEFAULT_SETTINGS, type Properties, type PropertyScalar, type PropertyValue, type Task } from '../../../src/types';
import { PropertyUpdatePlanner } from '../../../src/services/persistence/PropertyUpdatePlanner';
import { PropertyValues } from '../../../src/services/parsing/utils/PropertyValues';
import { getEffectiveProperties } from '../../../src/services/data/EffectiveProperties';

function taskOf(lines: string[], content: string): Task {
    const parsed = FileParsePipeline.parse('note.md', lines, DEFAULT_SETTINGS, namesOutsideIndex('note.md'));
    if (parsed.ignored) throw new Error('ignored');
    return parsed.tasks.find(task => task.content === content)!;
}

const plan = (task: Task, updates: Partial<Task>) => PropertyUpdatePlanner.plan(task, updates, DEFAULT_SCOPE_KEYS);
const props = (entries: Record<string, PropertyValue>): Properties =>
    Object.fromEntries(Object.entries(entries).map(([key, value]) => [key.toLowerCase(), { key, value }]));
const list = (...items: string[]): PropertyValue => ({
    type: 'list',
    items: items.map(item => PropertyValues.fromText(item) as PropertyScalar),
});

describe('PropertyUpdatePlanner', () => {
    const TASK = ['- [ ] T', '\t- area:: lab', '\t- n:: 007', '\t- e::'];

    it('sets a value as spelled, and writes nothing for one spelled as it is', () => {
        const task = taskOf(TASK, 'T');
        const own = task.properties;
        expect(plan(task, { properties: { ...own, n: { key: 'n', value: PropertyValues.fromText('7') } } }))
            .toEqual([{ key: 'n', op: 'set', value: { text: '7' } }]);
        expect(plan(task, { properties: { ...own, n: { key: 'n', value: PropertyValues.fromText('007') } } })).toEqual([]);
    });

    it('hides with no value, deletes a key left out, and tells the two apart', () => {
        const task = taskOf(TASK, 'T');
        const { e: _e, ...rest } = task.properties;
        expect(plan(task, { properties: rest })).toEqual([{ key: 'e', op: 'delete' }]);
        expect(plan(task, { properties: { ...task.properties, area: { key: 'area', value: { type: 'null', spelling: '' } } } }))
            .toEqual([{ key: 'area', op: 'hide' }]);
        // `null` typed is written as typed.
        expect(plan(task, { properties: { ...task.properties, area: { key: 'area', value: PropertyValues.fromText('null') } } }))
            .toEqual([{ key: 'area', op: 'set', value: { text: 'null' } }]);
    });

    it('writes a list as its items, each as spelled, and none as a delete', () => {
        const task = taskOf(TASK, 'T');
        expect(plan(task, { properties: { ...task.properties, ...props({ tags2: list('a', '"12"') }) } }))
            .toEqual([{ key: 'tags2', op: 'set', value: { items: ['a', '"12"'] } }]);
        expect(plan(task, { properties: { ...task.properties, ...props({ area: { type: 'list', items: [] } }) } }))
            .toEqual([{ key: 'area', op: 'delete' }]);
    });

    it('writes a list again when its items are reordered, and not when they are as they were', () => {
        const task = taskOf(['- [ ] T', '\t- k::', '\t\t- a', '\t\t- b'], 'T');
        expect(plan(task, { properties: props({ k: list('b', 'a') }) })).toEqual([{ key: 'k', op: 'set', value: { items: ['b', 'a'] } }]);
        expect(plan(task, { properties: props({ k: list('a', 'b') }) })).toEqual([]);
    });

    it('writes an inherited value as the task\'s own, the same value too, the frontmatter\'s text quoted as it reads', () => {
        const task = taskOf(['---', 'id: "123"', 'area: lab', '---', '- [ ] T'], 'T');
        const inherited = getEffectiveProperties(task);
        expect(plan(task, { properties: { area: inherited.area } })).toEqual([{ key: 'area', op: 'set', value: { text: 'lab' } }]);
        expect(plan(task, { properties: { id: inherited.id } })).toEqual([{ key: 'id', op: 'set', value: { text: '"123"' } }]);
    });

    it('sets, hides and deletes a built-in: a text, null, and nothing', () => {
        const task = taskOf(['- [ ] T', '\t- tv-color:: red'], 'T');
        expect(plan(task, { color: 'blue' })).toEqual([{ key: 'tv-color', op: 'set', value: { text: 'blue' } }]);
        expect(plan(task, { color: null })).toEqual([{ key: 'tv-color', op: 'hide' }]);
        expect(plan(task, { color: undefined })).toEqual([{ key: 'tv-color', op: 'delete' }]);
        expect(plan(task, { color: ' ' })).toEqual([{ key: 'tv-color', op: 'delete' }]);
    });
});
