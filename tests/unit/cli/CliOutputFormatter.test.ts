import { describe, it, expect } from 'vitest';
import { resolveFields, pickFields, formatOutput, formatSingleTask, cliOk, cliError } from '../../../src/cli/CliOutputFormatter';
import { taskToRecord } from '../../../src/api/TaskNormalizer';
import { normalizeTask } from '../../../src/api/TaskNormalizer';
import { makeTask } from '../helpers/makeTask';
import { toDisplayTask } from '../../../src/services/display/DisplayTaskConverter';
import { PropertyValues } from '../../../src/services/parsing/utils/PropertyValues';

/** No row answers to a name: every ID goes out as it is. */
const noRow = () => undefined;

/** Helper: makeTask → DisplayTask → NormalizedTask */
function makeNormalized(overrides: Parameters<typeof makeTask>[0] = {}) {
    return normalizeTask(toDisplayTask(makeTask(overrides), 5), noRow);
}

describe('CliOutputFormatter', () => {
    describe('taskToRecord (from TaskNormalizer)', () => {
        it('formats a basic task with specified fields', () => {
            const task = makeTask({
                id: 'tv-inline:daily/2026-03-14.md:ln:5',
                file: 'daily/2026-03-14.md',
                line: 5,
                content: 'Buy groceries',
                statusChar: ' ',
                startDate: '2026-03-14',
                startTime: '10:00',
                endDate: '2026-03-14',
                endTime: '11:00',
                tags: ['#shopping'],
                parserId: 'tv-inline',
            });

            const fields = resolveFields('file,line,content,status,startDate,startTime,endDate,endTime,tags,parserId');
            const result = taskToRecord(task, fields, noRow);

            expect(result.id).toBe('tv-inline:daily/2026-03-14.md:ln:5');
            expect(result.file).toBe('daily/2026-03-14.md');
            expect(result.line).toBe(5);
            expect(result.content).toBe('Buy groceries');
            expect(result.status).toBe(' ');
            expect(result.startDate).toBe('2026-03-14');
            expect(result.startTime).toBe('10:00');
            expect(result.endDate).toBe('2026-03-14');
            expect(result.endTime).toBe('11:00');
            expect(result.tags).toEqual(['#shopping']);
            expect(result.parserId).toBe('tv-inline');
        });

        it('uses null for missing optional fields', () => {
            const task = makeTask({});
            const fields = resolveFields('startDate,startTime,endDate,endTime,due,parentId,color,linestyle');
            const result = taskToRecord(task, fields, noRow);

            expect(result.startDate).toBeNull();
            expect(result.startTime).toBeNull();
            expect(result.endDate).toBeNull();
            expect(result.endTime).toBeNull();
            expect(result.due).toBeNull();
            expect(result.parentId).toBeNull();
            expect(result.color).toBeNull();
            expect(result.linestyle).toBeNull();
        });

        it('only includes requested fields', () => {
            const task = makeTask({ content: 'Test', startDate: '2026-03-14' });
            const result = taskToRecord(task, ['content', 'startDate'], noRow);

            expect(Object.keys(result)).toEqual(['content', 'startDate']);
            expect(result.content).toBe('Test');
            expect(result.startDate).toBe('2026-03-14');
        });
    });

    describe('formatOutput', () => {
        it('wraps tasks in count + tasks structure (json)', () => {
            const tasks = [makeNormalized({ content: 'A' }), makeNormalized({ content: 'B' })];
            const fields = resolveFields('content');
            const result = JSON.parse(formatOutput(tasks, 'json', fields));

            expect(result.count).toBe(2);
            expect(result.tasks).toHaveLength(2);
            expect(result.tasks[0].content).toBe('A');
            expect(result.tasks[1].content).toBe('B');
        });

        it('returns count 0 for empty array', () => {
            const result = JSON.parse(formatOutput([], 'json', resolveFields(undefined)));
            expect(result.count).toBe(0);
            expect(result.tasks).toEqual([]);
        });

        it('formats as tsv with header row', () => {
            const tasks = [makeNormalized({ content: 'A' })];
            const fields = ['content', 'status'];
            const result = formatOutput(tasks, 'tsv', fields);
            const lines = result.split('\n');
            expect(lines[0]).toBe('content\tstatus');
            expect(lines[1]).toContain('A');
        });

        it('keeps a tsv row on one line when the content holds U+2028 or U+2029', () => {
            // A note keeps them inside a line, but a reader of tsv may
            // split its rows there, as at a newline.
            const content = ['a', 'b', 'c'].join(String.fromCharCode(0x2028)) + String.fromCharCode(0x2029) + 'd';
            const row = formatOutput([makeNormalized({ content })], 'tsv', ['content']).split('\n')[1];
            expect(row).toBe('a b c d');
        });

        it('writes properties in a tsv cell as the JSON the json format holds for them', () => {
            const task = makeNormalized({
                properties: {
                    area: PropertyValues.fromText('lab'),
                    n: PropertyValues.fromText('3'),
                    who: PropertyValues.fromYaml(['a', 'b'])!,
                },
            });
            const row = formatOutput([task], 'tsv', ['properties']).split('\n')[1];
            expect(row).toBe('{"area":"lab","n":3,"who":["a","b"]}');
            expect(JSON.parse(row)).toEqual(JSON.parse(formatOutput([task], 'json', ['properties'])).tasks[0].properties);
            expect(formatSingleTask(task, 'tsv', ['properties']).split('\n')[1]).toBe(row);
        });

        it('writes a number JSON cannot write as its YAML spelling, and no value as null', () => {
            const task = makeNormalized({
                properties: {
                    inf: PropertyValues.fromText('.inf'),
                    neg: PropertyValues.fromText('-.Inf'),
                    nan: PropertyValues.fromText('.nan'),
                    list: PropertyValues.fromYaml([1, Infinity])!,
                    none: PropertyValues.fromText(''),
                    hex: PropertyValues.fromText('0x1F'),
                },
            });
            const expected = { inf: '.inf', neg: '-.inf', nan: '.nan', list: [1, '.inf'], none: null, hex: 31 };
            expect(JSON.parse(formatOutput([task], 'json', ['properties'])).tasks[0].properties).toEqual(expected);
            expect(JSON.parse(formatOutput([task], 'tsv', ['properties']).split('\n')[1])).toEqual(expected);
        });

        it('keeps a tsv row on one line when a property value holds a tab or a line break', () => {
            const task = makeNormalized({ properties: { note: PropertyValues.fromYaml('a\tb\nc')! } });
            const row = formatOutput([task], 'tsv', ['properties']).split('\n')[1];
            expect(JSON.parse(row)).toEqual({ note: 'a\tb\nc' });
        });

        it('formats as jsonl with one line per task', () => {
            const tasks = [makeNormalized({ content: 'A' }), makeNormalized({ content: 'B' })];
            const fields = ['content'];
            const result = formatOutput(tasks, 'jsonl', fields);
            const lines = result.split('\n');
            expect(lines).toHaveLength(2);
            expect(JSON.parse(lines[0]).content).toBe('A');
            expect(JSON.parse(lines[1]).content).toBe('B');
        });
    });

    describe('resolveFields', () => {
        it('returns id only for undefined', () => {
            const fields = resolveFields(undefined);
            expect(fields).toEqual(['id']);
        });

        it('always includes id even if not specified', () => {
            const fields = resolveFields('content,status');
            expect(fields).toEqual(['id', 'content', 'status']);
        });

        it('does not duplicate id if already specified', () => {
            const fields = resolveFields('id,content');
            expect(fields).toEqual(['id', 'content']);
        });

        it('throws on unknown field names', () => {
            expect(() => resolveFields('content,invalid')).toThrow('Unknown field(s): invalid');
        });

        it('throws on "all" and "default" (no longer special)', () => {
            expect(() => resolveFields('all')).toThrow('Unknown field(s): all');
            expect(() => resolveFields('default')).toThrow('Unknown field(s): default');
        });
    });

    describe('cliOk', () => {
        it('returns JSON string', () => {
            const result = cliOk({ status: 'ok', id: 'test' });
            expect(JSON.parse(result)).toEqual({ status: 'ok', id: 'test' });
        });
    });

    describe('cliError', () => {
        it('returns JSON with error field', () => {
            const result = cliError('Something went wrong');
            expect(JSON.parse(result)).toEqual({ error: 'Something went wrong', help: 'obsidian obsidian-task-viewer:help' });
        });
    });
});

describe('boolean properties (TaskNormalizer)', () => {
    it('reads true whether a property line spells it True or frontmatter reads it back as true', () => {
        const normalized = makeNormalized({
            properties: {
                line: PropertyValues.fromText('True'),
                front: PropertyValues.fromYaml(true)!,
                off: PropertyValues.fromText('false'),
            },
        });
        expect(normalized.properties).toMatchObject({ line: true, front: true, off: false });
    });
});
