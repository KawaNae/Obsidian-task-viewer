import { describe, it, expect } from 'vitest';
import type { App } from 'obsidian';
import { FileParsePipeline } from '../../../src/services/parsing/FileParsePipeline';
import { namesOutsideIndex } from '../../../src/services/core/RowNames';
import { DEFAULT_SETTINGS, type DisplayTask } from '../../../src/types';
import { toDisplayTask, NO_TASK_LOOKUP } from '../../../src/services/display/DisplayTaskConverter';
import { resolveQuery } from '../../../src/api/FilterParamsBuilder';
import type { PropertyCondition } from '../../../src/services/filter/FilterTypes';
import { FilterValueCollector } from '../../../src/services/filter/FilterValueCollector';
import { evaluateFilter } from '../helpers/filterContext';

/**
 * A note per task, the task's text its name: each holds the property `k` as
 * its line, a list or the frontmatter writes it.
 */
const NOTES: Record<string, string[]> = {
    one: ['- [ ] one', '    - k:: 1'],
    oneDot: ['- [ ] oneDot', '    - k:: 1.0'],
    ten: ['- [ ] ten', '    - k:: 10'],
    hex: ['- [ ] hex', '    - k:: 0x1F'],
    num123: ['- [ ] num123', '    - k:: 123'],
    text123: ['- [ ] text123', '    - k:: "123"'],
    trueCap: ['- [ ] trueCap', '    - k:: True'],
    trueLow: ['- [ ] trueLow', '    - k:: true'],
    lab: ['- [ ] lab', '    - k:: Lab'],
    upperKey: ['- [ ] upperKey', '    - K:: desk'],
    emptyText: ['- [ ] emptyText', '    - k:: ""'],
    noValue: ['- [ ] noValue', '    - k::'],
    nullWord: ['- [ ] nullWord', '    - k:: null'],
    list: ['- [ ] list', '    - k::', '        - a', '        - Bee'],
    fmList: ['---', 'k: [x, 2]', '---', '- [ ] fmList'],
    fmEmptyList: ['---', 'k: []', '---', '- [ ] fmEmptyList'],
    fmNoValue: ['---', 'k:', '---', '- [ ] fmNoValue'],
    hidden: ['---', 'k: lab', '---', '# A', '- k::', '- [ ] hidden'],
    missing: ['- [ ] missing', '    - other:: lab'],
};

const TASKS: DisplayTask[] = Object.entries(NOTES).flatMap(([name, lines]) =>
    FileParsePipeline.parse(`${name}.md`, lines, DEFAULT_SETTINGS, namesOutsideIndex(`${name}.md`))
        .tasks.map(t => toDisplayTask(t, 0, NO_TASK_LOOKUP)));

const FILE = 'filters/property.json';

function appWith(files: Record<string, string>): App {
    return {
        vault: {
            adapter: {
                exists: async (path: string) => path in files,
                read: async (path: string) => files[path] ?? '',
            },
        },
    } as unknown as App;
}

/** The tasks a query passes, by name. */
async function passing(params: Parameters<typeof resolveQuery>[1], app: App = appWith({})): Promise<string[]> {
    const { filter } = await resolveQuery(app, params);
    if (!filter) throw new Error('no filter');
    return TASKS.filter(t => evaluateFilter(t, filter)).map(t => t.content);
}

type Row = Omit<PropertyCondition, 'property'>;

/**
 * The tasks a property condition passes, asked through each entry that can
 * ask it: the API's and the CLI's `filter` (JSON), a filter file, and, for
 * `contains`, the shorthand `property=key:value`. Every entry answers alike.
 */
async function which(row: Row): Promise<string[]> {
    const condition = { property: 'property', ...row };
    const filter = { logic: 'and', filters: [condition] };
    const byJson = await passing({ filter });
    const byFile = await passing({ filterFile: FILE }, appWith({ [FILE]: JSON.stringify(filter) }));
    expect(byFile).toEqual(byJson);
    if (row.operator === 'contains') {
        const byShorthand = await passing({ property: `${row.key}:${row.value}` });
        expect(byShorthand).toEqual(byJson);
    }
    return byJson;
}

describe('a property condition', () => {
    it('isSet: a task whose property has a value, the empty text and the empty list among them', async () => {
        expect(await which({ operator: 'isSet', key: 'k' })).toEqual([
            'one', 'oneDot', 'ten', 'hex', 'num123', 'text123', 'trueCap', 'trueLow', 'lab', 'upperKey',
            'emptyText', 'list', 'fmList', 'fmEmptyList',
        ]);
    });

    it('isNotSet: a task whose property has no value (a line\'s, the frontmatter\'s, one hiding the value above), or which has none', async () => {
        expect(await which({ operator: 'isNotSet', key: 'k' }))
            .toEqual(['noValue', 'nullWord', 'fmNoValue', 'hidden', 'missing']);
    });

    it('equals a number: by its value, whatever its spelling', async () => {
        expect(await which({ operator: 'equals', key: 'k', value: '1' })).toEqual(['one', 'oneDot']);
        expect(await which({ operator: 'equals', key: 'k', value: '1.0' })).toEqual(['one', 'oneDot']);
        expect(await which({ operator: 'equals', key: 'k', value: '31' })).toEqual(['hex']);
        expect(await which({ operator: 'equals', key: 'k', value: '+10' })).toEqual(['ten']);
    });

    it('equals 123: the number and the text; "123" in quotes: the text alone', async () => {
        expect(await which({ operator: 'equals', key: 'k', value: '123' })).toEqual(['num123', 'text123']);
        expect(await which({ operator: 'equals', key: 'k', value: '"123"' })).toEqual(['text123']);
        expect(await which({ operator: 'equals', key: 'k', value: '\'123\'' })).toEqual(['text123']);
    });

    it('equals a boolean: by its value, whatever its spelling', async () => {
        expect(await which({ operator: 'equals', key: 'k', value: 'true' })).toEqual(['trueCap', 'trueLow']);
        expect(await which({ operator: 'equals', key: 'k', value: 'TRUE' })).toEqual(['trueCap', 'trueLow']);
        expect(await which({ operator: 'equals', key: 'k', value: '"true"' })).toEqual([]);
    });

    it('equals a text: its case aside, the whole of it', async () => {
        expect(await which({ operator: 'equals', key: 'k', value: 'lab' })).toEqual(['lab']);
        expect(await which({ operator: 'equals', key: 'k', value: '"LAB"' })).toEqual(['lab']);
        expect(await which({ operator: 'equals', key: 'k', value: 'la' })).toEqual([]);
    });

    it('equals one of a list\'s items', async () => {
        expect(await which({ operator: 'equals', key: 'k', value: 'a' })).toEqual(['list']);
        expect(await which({ operator: 'equals', key: 'k', value: 'bee' })).toEqual(['list']);
        expect(await which({ operator: 'equals', key: 'k', value: 'a, Bee' })).toEqual([]);
        expect(await which({ operator: 'equals', key: 'k', value: 'x' })).toEqual(['fmList']);
        expect(await which({ operator: 'equals', key: 'k', value: '2.0' })).toEqual(['fmList']);
    });

    it('equals nothing with no value: an empty value finds the empty text alone', async () => {
        expect(await which({ operator: 'equals', key: 'k', value: '' })).toEqual(['emptyText']);
        expect(await which({ operator: 'equals', key: 'k', value: 'null' })).toEqual([]);
    });

    it('contains a text, its case aside, in the value as shown', async () => {
        expect(await which({ operator: 'contains', key: 'k', value: 'AB' })).toEqual(['lab']);
        expect(await which({ operator: 'contains', key: 'k', value: '"ab"' })).toEqual(['lab']);
        expect(await which({ operator: 'contains', key: 'k', value: 'ul' })).toEqual([]);
    });

    it('contains in one of a list\'s items', async () => {
        expect(await which({ operator: 'contains', key: 'k', value: 'EE' })).toEqual(['list']);
        expect(await which({ operator: 'contains', key: 'k', value: 'a, b' })).toEqual([]);
    });

    it('contains in a number\'s or a boolean\'s spelling; quoted, in a text alone', async () => {
        expect(await which({ operator: 'contains', key: 'k', value: '1' }))
            .toEqual(['one', 'oneDot', 'ten', 'hex', 'num123', 'text123']);
        expect(await which({ operator: 'contains', key: 'k', value: 'x1f' })).toEqual(['hex']);
        expect(await which({ operator: 'contains', key: 'k', value: '"1"' })).toEqual(['text123']);
        expect(await which({ operator: 'contains', key: 'k', value: 'ru' })).toEqual(['trueCap', 'trueLow']);
        expect(await which({ operator: 'contains', key: 'k', value: '"ru"' })).toEqual([]);
    });

    it('notContains: contains in none of the items, a task with no value or without the property too', async () => {
        expect(await which({ operator: 'notContains', key: 'k', value: 'a' })).toEqual([
            'one', 'oneDot', 'ten', 'hex', 'num123', 'text123', 'trueCap', 'trueLow', 'upperKey',
            'emptyText', 'noValue', 'nullWord', 'fmList', 'fmEmptyList', 'fmNoValue', 'hidden', 'missing',
        ]);
        expect(await which({ operator: 'notContains', key: 'k', value: 'ul' })).toHaveLength(Object.keys(NOTES).length);
    });

    it('names its key in any case', async () => {
        expect(await which({ operator: 'equals', key: 'k', value: 'desk' })).toEqual(['upperKey']);
        expect(await which({ operator: 'contains', key: 'K', value: 'des' })).toEqual(['upperKey']);
        expect(await which({ operator: 'isSet', key: 'OTHER' })).toEqual(['missing']);
    });
});

describe('the values a property condition offers', () => {
    const offered = FilterValueCollector.collectPropertyItemsForKey(TASKS, 'K');

    it('are the items the tasks show, one by one, without no value', () => {
        expect(offered).toEqual(['0x1F', '1', '1.0', '10', '123', '2', 'Bee', 'Lab', 'True', 'a', 'desk', 'true', 'x']);
    });

    it('each find, as `equals`, the tasks that show them', async () => {
        for (const value of offered) {
            const found = await which({ operator: 'equals', key: 'k', value });
            const showing = TASKS
                .filter(t => FilterValueCollector.collectPropertyItemsForKey([t], 'k').includes(value))
                .map(t => t.content);
            expect(found).toEqual(expect.arrayContaining(showing));
        }
    });
});

describe('the values the hub offers for a property', () => {
    it('are the items the tasks write, one by one, as spelled, without no value: a quoted text apart from the number', () => {
        expect(FilterValueCollector.collectPropertySpellingsForKey(TASKS, 'K')).toEqual(
            ['""', '"123"', '0x1F', '1', '1.0', '10', '123', '2', 'Bee', 'Lab', 'True', 'a', 'desk', 'true', 'x'],
        );
    });
});
