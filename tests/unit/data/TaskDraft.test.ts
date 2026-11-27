import { describe, it, expect } from 'vitest';
import { applyToDraft, draftTask, newRowOf, withPlace, DRAFT_ID, type DraftAt } from '../../../src/services/data/TaskDraft';
import type { ResolvedSources } from '../../../src/services/parsing/tree/Sections';
import { DEFAULT_SCOPE_KEYS, type PropertyScalar } from '../../../src/types';
import { statedDates } from '../../../src/utils/TaskDates';
import { getEffectiveColor } from '../../../src/services/data/EffectiveProperties';
import { byKey } from '../helpers/properties';

/**
 * A task not written yet (`TaskDraft`): its own values as given, and
 * what the place gives it whatever it says itself, its own standing over
 * it; a new name taking its tags with it; and the row a write is
 * handed from it, a line for every value of its own and none for a value it
 * has none of.
 */

const text = (s: string): PropertyScalar => ({ type: 'text', text: s, spelling: s });
const FROM: ResolvedSources = { fields: { startDate: { kind: 'section', line: 1, heading: null } }, tags: [], properties: {} };
const AT: DraftAt = {
    file: 'n.md',
    inherits: { startDate: '2031-02-01', startTime: '10:00', color: 'ff0000', tags: ['ft'], properties: byKey({ area: text('lab') }) },
    inheritedFrom: FROM,
};

describe('draftTask', () => {
    it('is no row: named as none of the index is, in the place\'s note, on no line, with nothing under it', () => {
        const task = draftTask(AT);
        expect(task).toMatchObject({ id: DRAFT_ID, file: 'n.md', line: -1, content: '', statusChar: ' ', parserId: 'tv-inline', childIds: [], childLines: [] });
        expect(task.isReadOnly).toBeFalsy();
        expect(task.propertyFindings).toBeUndefined();
    });

    it('holds the seed\'s values as its own, the name\'s tags among its tags', () => {
        const task = draftTask(AT, { statusChar: '/', content: '会議 #work', startTime: '09:00', due: '2031-02-10', tags: ['plan'], mask: null, properties: byKey({ owner: text('me') }) });
        expect(task).toMatchObject({ statusChar: '/', content: '会議 #work', startTime: '09:00', due: '2031-02-10', tags: ['plan', 'work'], mask: null });
        expect(task.properties).toEqual(byKey({ owner: text('me') }));
        expect('color' in task).toBe(false);
    });

    it('is given what the place gives whatever it says itself, and says from where', () => {
        const task = draftTask(AT, { startTime: '09:00' });
        expect(task.cascadeContext).toEqual(AT.inherits);
        expect(statedDates(task)).toEqual({ startDate: '2031-02-01', startTime: '09:00' });
        expect(task.inheritedFrom).toBe(FROM);
        expect(draftTask({ file: 'n.md', inherits: {} }).cascadeContext).toBeUndefined();
    });
});

describe('applyToDraft', () => {
    it('puts the change over the draft', () => {
        const task = applyToDraft(draftTask(AT), { statusChar: 'x', color: '00ff00' }, AT);
        expect(task).toMatchObject({ statusChar: 'x', color: '00ff00' });
    });

    it('takes a new name\'s tags in place of the old name\'s, and keeps the tags it declares', () => {
        const task = draftTask(AT, { content: '#x 買う', tags: ['y'] });
        expect(task.tags).toEqual(['x', 'y']);
        expect(applyToDraft(task, { content: '買う #z' }, AT).tags).toEqual(['y', 'z']);
        // A tag both declared and in the old name stays declared.
        expect(applyToDraft(draftTask(AT, { content: '#y', tags: ['y'] }), { content: '' }, AT).tags).toEqual([]);
    });

    it('takes the tags handed with a new name as they are', () => {
        const task = draftTask(AT, { content: '#x' });
        expect(applyToDraft(task, { content: '#q', tags: ['q', 'w'] }, AT).tags).toEqual(['q', 'w']);
    });

    it('keeps what the place gives as its own values change: a date it says stands over the place\'s, and taken out the place\'s shows', () => {
        const task = draftTask(AT);
        const said = applyToDraft(task, { startDate: '2031-03-01' }, AT);
        expect(said.cascadeContext?.startDate).toBe('2031-02-01');
        expect(statedDates(said).startDate).toBe('2031-03-01');
        expect(statedDates(applyToDraft(said, { startDate: undefined }, AT)).startDate).toBe('2031-02-01');
        // A style it has none of hides the place's.
        const none = applyToDraft(task, { color: null }, AT);
        expect(none.cascadeContext?.color).toBe('ff0000');
        expect(getEffectiveColor(none)).toBeUndefined();
    });
});

describe('withPlace', () => {
    it('puts the draft in the place answered again: its note, what it inherits and from where', () => {
        const task = draftTask(AT, { startTime: '09:00' });
        const moved = withPlace(task, { file: 'm.md', inherits: { startTime: '08:00', due: '2031-04-01' } });
        expect(moved).toMatchObject({ file: 'm.md', startTime: '09:00' });
        expect(moved.cascadeContext).toEqual({ startTime: '08:00', due: '2031-04-01' });
        expect('inheritedFrom' in moved).toBe(false);
        expect(withPlace(task, { file: 'm.md', inherits: {} }).cascadeContext).toBeUndefined();
    });
});

describe('newRowOf', () => {
    it('is the line alone for a draft with nothing of its own', () => {
        expect(newRowOf(draftTask(AT), DEFAULT_SCOPE_KEYS)).toEqual({ line: '- [ ] ' });
    });

    it('writes the line of the status, the name and the dates', () => {
        const task = draftTask(AT, { statusChar: 'x', content: '会議', startDate: '2031-02-01', startTime: '10:00', endTime: '11:00', due: '2031-02-10' });
        expect(newRowOf(task, DEFAULT_SCOPE_KEYS).line).toBe('- [x] 会議 @2031-02-01T10:00>11:00>2031-02-10');
    });

    it('writes a line for each value of its own, hides what it says it has none of, and writes one alike to what it inherits', () => {
        const task = draftTask(AT, {
            content: '会議 #work',
            tags: ['plan'],
            color: 'ff0000',
            mask: null,
            properties: byKey({ area: text('lab'), items: { type: 'list', items: [text('a'), text('b')] }, empty: { type: 'null', spelling: '' } }),
        });
        expect(newRowOf(task, DEFAULT_SCOPE_KEYS).properties?.ops).toEqual([
            { key: 'tv-color', op: 'set', value: { text: 'ff0000' } },
            { key: 'tv-mask', op: 'hide' },
            { key: 'tags', op: 'set', value: { tags: ['plan'] } },
            { key: 'area', op: 'set', value: { text: 'lab' } },
            { key: 'items', op: 'set', value: { items: ['a', 'b'] } },
            { key: 'empty', op: 'hide' },
        ]);
    });

    it('writes no line for a value it has none of: an empty style, the name\'s tags alone, a list of nothing', () => {
        const task = draftTask(AT, { content: '#work', tags: ['work'], color: '', linestyle: '  ', properties: byKey({ none: { type: 'list', items: [] } }) });
        expect(newRowOf(task, DEFAULT_SCOPE_KEYS)).toEqual({ line: '- [ ] #work' });
    });
});
