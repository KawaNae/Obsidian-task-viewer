import { describe, it, expect } from 'vitest';
import { FileParsePipeline } from '../../../src/services/parsing/FileParsePipeline';
import { namesOutsideIndex } from '../../../src/services/core/RowNames';
import { DEFAULT_SCOPE_KEYS, DEFAULT_SETTINGS, type DisplayTask, type Task } from '../../../src/types';
import { TaskValues } from '../../../src/services/filter/TaskValues';
import { FilterValueCollector } from '../../../src/services/filter/FilterValueCollector';
import { resolveTopRightField } from '../../../src/views/taskcard/TopRightFieldResolver';
import { normalizeTask } from '../../../src/api/TaskNormalizer';
import { toDisplayTask, NO_TASK_LOOKUP } from '../../../src/services/display/DisplayTaskConverter';
import { FrontmatterLineEditor } from '../../../src/services/persistence/utils/FrontmatterLineEditor';
import { ChildPropertyLineEditor } from '../../../src/services/persistence/utils/ChildPropertyLineEditor';
import { PropertyUpdatePlanner } from '../../../src/services/persistence/PropertyUpdatePlanner';
import { draftOver } from '../../../src/services/persistence/FileLines';
import { Outline } from '../../../src/services/parsing/utils/Outline';
import { PropertyLines } from '../../../src/services/parsing/utils/PropertyLines';
import { PropertyValues } from '../../../src/services/parsing/utils/PropertyValues';
import { CascadeSource } from '../../../src/modals/hub/CascadeSource';
import { shorthandConditions } from '../../../src/api/QueryShorthand';
import type { FilterCondition, FilterState } from '../../../src/services/filter/FilterTypes';
import { evaluateFilter } from '../helpers/filterContext';
import { byKey } from '../helpers/properties';

const read = (lines: string[]) => FileParsePipeline.parse('n.md', lines, DEFAULT_SETTINGS, namesOutsideIndex('n.md'));
const shown = (task: Task): DisplayTask => toDisplayTask(task, 5, NO_TASK_LOOKUP);
const tasks = (lines: string[]) => read(lines).tasks.map(shown);
const noRow = () => undefined;
/** The value the filter compares for `key`, as it is shown; none when no layer writes the key. */
const shownBy = (t: DisplayTask, key: string) => {
    const value = TaskValues.property(t, key);
    return value && PropertyValues.display(value);
};

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
        expect(shownBy(t, 'Area')).toBe('lab');
        expect(shownBy(t, 'zone')).toBe('north');
        expect(shownBy(t, 'weight')).toBe('3');
        expect(resolveTopRightField(t, 'prop.Area', DEFAULT_SETTINGS)).toBe('lab');
        expect(normalizeTask(t, noRow).properties).toEqual({ zone: 'north', Area: 'lab', weight: 3 });
    });

    it('is offered by the filter menus as written, with its values', () => {
        const all = tasks(note);
        expect(FilterValueCollector.collectPropertyKeys(all)).toEqual(['Area', 'weight', 'zone']);
        expect(FilterValueCollector.collectPropertySpellingsForKey(all, 'Area')).toEqual(['lab']);
    });

    it('of a task overrides the same key above it, written the same way', () => {
        const [t] = tasks(['---', 'area: desk', '---', '- [ ] t', '    - area:: lab']);
        expect(shownBy(t, 'area')).toBe('lab');
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

/** A key names one property whatever its case, on every layer and for every reader; a key's width is kept. */
describe('a property key, its case aside', () => {
    const findings = (lines: string[], line: number) => {
        const own = PropertyLines.ofTask(Outline.read(lines), line);
        return PropertyLines.read(own, DEFAULT_SCOPE_KEYS).findings.map(f => [f.kind, f.line, f.key]);
    };

    it('is one property across the layers: the nearer layer wins, shown as that layer writes it', () => {
        const [t] = tasks(['---', 'area: desk', 'zone: north', '---', '# A', '- ZONE:: south', '- [ ] t', '    - Area:: lab']);
        expect(shownBy(t, 'area')).toBe('lab');
        expect(shownBy(t, 'zone')).toBe('south');
        expect(normalizeTask(t, noRow).properties).toEqual({ ZONE: 'south', Area: 'lab' });
        expect(CascadeSource.forProperty(t, 'Zone')).toBe('section');
    });

    it('names a built-in in any case, on every layer, and is no custom property', () => {
        const [t] = tasks(['- [ ] t', '    - TV-COLOR:: red', '    - Tags:: #a', '    - TV-Mask:: ***']);
        expect([t.color, t.tags, t.mask]).toEqual(['red', ['a'], '***']);
        expect(normalizeTask(t, noRow).properties).toEqual({});
        const [u] = tasks(['---', 'TV-Color: blue', 'TAGS: [b]', '---', '# A', '- TV-LINESTYLE:: dashed', '- [ ] u']);
        expect([u.cascadeContext?.color, u.cascadeContext?.tags, u.cascadeContext?.linestyle]).toEqual(['blue', ['b'], 'dashed']);
        expect(normalizeTask(u, noRow).properties).toEqual({});
    });

    it('names a date key in any case, which a task does not read', () => {
        const lines = ['- [ ] t', '    - TV-START:: 2026-01-01'];
        expect(findings(lines, 0)).toEqual([['date-key-under-task', 1, 'TV-START']]);
        const [t] = tasks(['# A', '- TV-Start:: 2026-01-01', '- [ ] t']);
        expect(t.cascadeContext?.startDate).toBe('2026-01-01');
    });

    it('written twice by one owner, in two cases, is an error on each line and read on neither', () => {
        const lines = ['- [ ] t', '    - Area:: a', '    - area:: b', '    - other:: c'];
        expect(findings(lines, 0)).toEqual([['duplicate-key', 1, 'Area'], ['duplicate-key', 2, 'area']]);
        const [t] = tasks(['---', 'area: fm', '---', ...lines]);
        expect(shownBy(t, 'area')).toBe('fm');
        expect(shownBy(t, 'other')).toBe('c');
        const [s] = tasks(['# A', '- Tags:: #a', '- tags:: #b', '- [ ] s']);
        expect(s.cascadeContext?.tags).toBeUndefined();
    });

    it('written twice by the frontmatter, in two cases, is read on neither; its other keys are read', () => {
        const [t] = tasks(['---', 'Area: lab', 'area: desk', 'TV-COLOR: red', 'tv-color: blue', 'zone: north', '---', '- [ ] t']);
        expect(shownBy(t, 'area')).toBeUndefined();
        expect(t.cascadeContext?.color).toBeUndefined();
        expect(normalizeTask(t, noRow).properties).toEqual({ zone: 'north' });
    });

    it('of the frontmatter\'s tags, written twice, takes the first key\'s tags, as Obsidian does', () => {
        const [t] = tasks(['---', 'Tags: [first]', 'tags: [second]', '---', '- [ ] t']);
        expect(t.cascadeContext?.tags).toEqual(['first']);
        expect(normalizeTask(t, noRow).properties).toEqual({});
    });

    it('keeps the width of its characters: a full-width key is another key, and `ｔａｇｓ` no tags', () => {
        const [t] = tasks(['---', 'area: half', '---', '- [ ] t', '    - ａｒｅａ:: full', '    - 担当１:: x', '    - ｔａｇｓ:: #a']);
        expect(shownBy(t, 'area')).toBe('half');
        expect(shownBy(t, 'ａｒｅａ')).toBe('full');
        expect(shownBy(t, 'ＡＲＥＡ')).toBe('full');
        expect(shownBy(t, '担当1')).toBeUndefined();
        expect(t.tags).toEqual([]);
        expect(normalizeTask(t, noRow).properties).toMatchObject({ area: 'half', 'ａｒｅａ': 'full', '担当１': 'x', 'ｔａｇｓ': '#a' });
    });

    it('is matched by a filter, the API\'s `property=` and the top right in any case', () => {
        const [t] = tasks(['- [ ] t', '    - Area:: lab']);
        const state = (conditions: FilterCondition[]): FilterState => ({ filters: conditions, logic: 'and' });
        expect(evaluateFilter(t, state([{ property: 'property', operator: 'equals', key: 'AREA', value: 'lab' }]))).toBe(true);
        expect(evaluateFilter(t, state(shorthandConditions({ property: 'area:lab' })))).toBe(true);
        expect(evaluateFilter(t, state([{ property: 'property', operator: 'isSet', key: 'ａｒｅａ' }]))).toBe(false);
        expect(resolveTopRightField(t, 'prop.area', DEFAULT_SETTINGS)).toBe('lab');
        expect(resolveTopRightField(t, 'prop.AREA', DEFAULT_SETTINGS)).toBe('lab');
    });

    it('is offered by the filter menus once, as the tasks most often write it', () => {
        const all = [
            ...tasks(['- [ ] a', '    - area:: x']),
            ...tasks(['- [ ] b', '    - Area:: y']),
            ...tasks(['- [ ] c', '    - Area:: z']),
        ];
        expect(FilterValueCollector.collectPropertyKeys(all)).toEqual(['Area']);
        expect(FilterValueCollector.collectPropertySpellingsForKey(all, 'AREA')).toEqual(['x', 'y', 'z']);
    });

    it('of a task\'s line is found by a write in any case, which keeps it as written', () => {
        const lines = ['- [ ] t', '    - Area:: lab', '    - ZONE:: n'];
        const { draft } = draftOver([...lines]);
        ChildPropertyLineEditor.applyOps(draft, 0, { ops: [{ key: 'area', op: 'set', value: { text: 'desk' } }, { key: 'zone', op: 'delete' }], keys: DEFAULT_SCOPE_KEYS }, '\t');
        expect(draft.lines).toEqual(['- [ ] t', '    - Area:: desk']);
    });

    it('is planned against the task\'s own in any case: a new value is set, the same value is no write, one left out is deleted', () => {
        const [t] = read(['- [ ] t', '    - Area:: lab']).tasks;
        const ops = PropertyUpdatePlanner.plan(t, { properties: byKey({ area: PropertyValues.fromText('desk'), Zone: PropertyValues.fromText('n') }) }, DEFAULT_SCOPE_KEYS);
        expect(ops).toEqual([{ key: 'area', op: 'set', value: { text: 'desk' } }, { key: 'Zone', op: 'set', value: { text: 'n' } }]);
        expect(PropertyUpdatePlanner.plan(t, { properties: byKey({ AREA: PropertyValues.fromText('lab') }) }, DEFAULT_SCOPE_KEYS)).toEqual([]);
        expect(PropertyUpdatePlanner.plan(t, { properties: {} }, DEFAULT_SCOPE_KEYS)).toEqual([{ key: 'Area', op: 'delete' }]);
    });

    it('of the frontmatter is found by a write in any case, which keeps it as written', () => {
        const lines = ['---', 'TV-COLOR: red', 'Area: lab', '---', 'body'];
        expect(FrontmatterLineEditor.hasKey(lines, 'area')).toBe(true);
        expect(FrontmatterLineEditor.hasKey(lines, 'ａｒｅａ')).toBe(false);
        const { draft } = draftOver([...lines]);
        FrontmatterLineEditor.applyUpdates(draft, 3, { 'tv-color': 'blue' });
        expect(draft.lines).toEqual(['---', 'TV-COLOR: blue', 'Area: lab', '---', 'body']);
        expect(FrontmatterLineEditor.valueRange('TV-COLOR: red', 'tv-color')).toEqual({ start: 10, end: 13 });
    });

    it('of tv-ignore is read in any case; written twice so, it is read on neither', () => {
        const ignored = (fm: string[]) => read(['---', ...fm, '---', '- [ ] t']).tasks.length === 0;
        expect(ignored(['TV-IGNORE: true'])).toBe(true);
        expect(ignored(['tv-ignore: true', 'TV-Ignore: true'])).toBe(false);
        expect(ignored(['TV-IGNORE: true', 'bad: ['])).toBe(true);
    });
});

describe('a scope key set in another case', () => {
    it('is read as that key: the setting `Farbe` reads `- farbe::`', () => {
        const settings = { ...DEFAULT_SETTINGS, scopeKeys: { ...DEFAULT_SETTINGS.scopeKeys, color: 'Farbe' } };
        const [t] = FileParsePipeline.parse('n.md', ['- [ ] t', '    - farbe:: red'], settings, namesOutsideIndex('n.md')).tasks;
        expect(t.color).toBe('red');
    });
});
