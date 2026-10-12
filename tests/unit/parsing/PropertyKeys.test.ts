import { describe, it, expect } from 'vitest';
import { FileParsePipeline } from '../../../src/services/parsing/FileParsePipeline';
import { namesOutsideIndex } from '../../../src/services/core/RowNames';
import { DEFAULT_SETTINGS, type DisplayTask, type Task } from '../../../src/types';
import { TaskValues } from '../../../src/services/filter/TaskValues';
import { FilterValueCollector } from '../../../src/services/filter/FilterValueCollector';
import { resolveTopRightField } from '../../../src/views/taskcard/TopRightFieldResolver';
import { normalizeTask } from '../../../src/api/TaskNormalizer';
import { toDisplayTask, NO_TASK_LOOKUP } from '../../../src/services/display/DisplayTaskConverter';
import { FrontmatterLineEditor } from '../../../src/services/persistence/utils/FrontmatterLineEditor';

const read = (lines: string[]) => FileParsePipeline.parse('n.md', lines, DEFAULT_SETTINGS, namesOutsideIndex('n.md'));
const shown = (task: Task): DisplayTask => toDisplayTask(task, 5, NO_TASK_LOOKUP);
const tasks = (lines: string[]) => read(lines).tasks.map(shown);
const noRow = () => undefined;

/** How a property's key is read, matched and shown, layer by layer and reader by reader. */
describe('a property key', () => {
    const note = [
        '---',
        'zone: north',
        '---',
        '# A',
        '- Area:: lab',
        '- [ ] t',
        '    - weight:: 3',
    ];

    it('is matched by the filter, the top right and the API as each layer writes it', () => {
        const [t] = tasks(note);
        expect(TaskValues.property(t, 'Area').text).toBe('lab');
        expect(TaskValues.property(t, 'zone').text).toBe('north');
        expect(TaskValues.property(t, 'weight').text).toBe('3');
        expect(resolveTopRightField(t, 'prop.Area', DEFAULT_SETTINGS)).toBe('lab');
        expect(normalizeTask(t, noRow).properties).toEqual({ zone: 'north', Area: 'lab', weight: 3 });
    });

    it('is offered by the filter menus as written, with its values', () => {
        const all = tasks(note);
        expect(FilterValueCollector.collectPropertyKeys(all)).toEqual(['Area', 'weight', 'zone']);
        expect(FilterValueCollector.collectPropertyValuesForKey(all, 'Area')).toEqual(['lab']);
    });

    it('of a task overrides the same key above it, written the same way', () => {
        const [t] = tasks(['---', 'area: desk', '---', '- [ ] t', '    - area:: lab']);
        expect(TaskValues.property(t, 'area').text).toBe('lab');
        expect(Object.keys(normalizeTask(t, noRow).properties)).toEqual(['area']);
    });

    it('of a built-in, as the settings spell it, is no custom property', () => {
        const [t] = tasks(['- [ ] t', '    - tv-color:: red', '    - tags:: #a']);
        expect(t.color).toBe('red');
        expect(t.tags).toEqual(['a']);
        expect(normalizeTask(t, noRow).properties).toEqual({});
    });
});

describe('tv-ignore in a block YAML refuses', () => {
    const ignored = (line: string) => read(['---', line, 'bad: [', '---', '- [ ] t']).tasks.length === 0;

    it('is read on the key\'s line at the start of a line, with or without a space after the colon', () => {
        expect(ignored('tv-ignore:true')).toBe(true);
        expect(ignored('tv-ignore : true')).toBe(true);
        expect(ignored('  tv-ignore: true')).toBe(false);
        expect(ignored('tv-ignore-x: true')).toBe(false);
    });
});

describe('a frontmatter key a write sets', () => {
    it('replaces the key\'s line and what continues it', () => {
        const lines = ['---', 'tv-color: red', 'list:', '  - a', '---', 'body'];
        const draft = { lines: [...lines], splice(at: number, n: number, ...put: string[]) { this.lines.splice(at, n, ...put); } };
        FrontmatterLineEditor.applyUpdates(draft as never, 4, { 'tv-color': 'blue', list: null });
        expect(draft.lines).toEqual(['---', 'tv-color: blue', '---', 'body']);
    });
});
