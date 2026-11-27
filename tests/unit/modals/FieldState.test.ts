import { describe, it, expect } from 'vitest';
import {
    FieldKinds,
    FieldStates,
    type FieldAction,
    type FieldFaint,
    type FieldKind,
    type FieldState,
} from '../../../src/modals/hub/fields/FieldState';
import { FileParsePipeline } from '../../../src/services/parsing/FileParsePipeline';
import { namesOutsideIndex } from '../../../src/services/core/RowNames';
import { splitLines } from '../../../src/services/persistence/FileLines';
import { DEFAULT_SETTINGS } from '../../../src/types';

/**
 * A field's look, its menu and what emptying it writes are read of its two
 * sides and its kind alone, the same table for every field of a value.
 * The states are named by their two sides: own (a value `v`, no value `-`,
 * none `·`) and inherited (a value `A`, no value `-`, none `·`).
 */

type StateName = 'v·' | 'vA' | 'v-' | '·A' | '-A' | '--' | '-·' | '·-' | '··';

function state(name: StateName): FieldState<string> {
    const [own, above] = [...name];
    return {
        own: own === 'v' ? { kind: 'value', value: 'mine' } : own === '-' ? { kind: 'noValue' } : { kind: 'none' },
        inherited: above === 'A' ? { kind: 'value', value: 'given', source: 'section' } : above === '-' ? { kind: 'noValue', source: 'file' } : { kind: 'none' },
    };
}

/** An item as the rows below write it: its action, and a drop's name (with `·field` for one reaching the field alone). */
function word(item: FieldAction | string): string {
    if (typeof item === 'string') return item;
    if (item.action === 'dropOwn') return item.reach === 'field' ? `${item.name}·field` : item.name;
    return item.action;
}

function faintWord(faint: FieldFaint): string {
    if (faint === null) return 'default';
    return faint.kind === 'noValue' ? 'noValue' : `${faint.kind}:${faint.text}`;
}

interface Row {
    look: string;
    items: string;
    emptied: string;
}

/** Each state's look (`frame faint`), items, and what emptying it writes, for one kind. */
function check(kind: FieldKind, table: Partial<Record<StateName, Row>>, extra?: readonly string[]) {
    for (const [name, want] of Object.entries(table) as [StateName, Row][]) {
        it(`${name}: ${want.look}; ${want.items || 'no item'}; emptied ${want.emptied}`, () => {
            const s = state(name);
            const look = FieldStates.look(s, kind, v => v);
            expect(`${look.frame} ${faintWord(look.faint)}`).toBe(want.look);
            const menu = FieldStates.menu(s, kind, { opensSource: true, kindItems: extra });
            expect(menu.items.map(word).join(', ')).toBe(want.items);
            expect(menu.source).toBe(name[1] === 'A' ? 'section' : name[1] === '-' ? 'file' : null);
            expect(FieldStates.emptied(s, kind)).toBe(want.emptied);
        });
    }
}

describe('FieldStates: a date or a time (the start\'s, the end\'s)', () => {
    check(FieldKinds.date, {
        'v·': { look: 'own default', items: 'clearValue', emptied: 'dropOwn' },
        'vA': { look: 'own value:given', items: 'openSource, clearToInherited', emptied: 'dropOwn' },
        'v-': { look: 'own noValue', items: 'openSource, clearToInherited', emptied: 'dropOwn' },
        '·A': { look: 'inherited value:given', items: 'openSource, writeInherited', emptied: 'nothing' },
        '·-': { look: 'inherited noValue', items: 'openSource', emptied: 'nothing' },
        '··': { look: 'own default', items: '', emptied: 'nothing' },
    });

    it('under a layer saying no value, shows the value the rules fill in, framed solid, where they fill one', () => {
        expect(FieldStates.look(state('·-'), FieldKinds.date, v => v, true)).toEqual({ frame: 'own', faint: null });
        expect(FieldStates.look(state('··'), FieldKinds.date, v => v, true)).toEqual({ frame: 'own', faint: null });
    });
});

describe('FieldStates: the due\'s date and time', () => {
    it('reach the whole due, but for the time\'s clearValue, which empties the time alone', () => {
        const items = (s: StateName, kind: FieldKind) => FieldStates.menu(state(s), kind, { opensSource: true }).items.map(word).join(', ');
        expect(items('v·', FieldKinds.dueDate)).toBe('clearValue');
        expect(items('v·', FieldKinds.dueTime)).toBe('clearValue·field');
        expect(items('vA', FieldKinds.dueTime)).toBe('openSource, clearToInherited');
        expect(items('·A', FieldKinds.dueTime)).toBe('openSource, writeInherited');
    });

    it('show the inherited due faint in the date\'s field once the row\'s own is emptied, and the time\'s own faint text in the time\'s, whose emptying keeps the date', () => {
        expect(FieldStates.look(state('vA'), FieldKinds.dueDate, v => v)).toEqual({ frame: 'own', faint: { kind: 'value', text: 'given' } });
        expect(FieldStates.look(state('vA'), FieldKinds.dueTime, v => v)).toEqual({ frame: 'own', faint: null });
        expect(FieldStates.look(state('·A'), FieldKinds.dueTime, v => v)).toEqual({ frame: 'inherited', faint: { kind: 'value', text: 'given' } });
    });
});

describe('FieldStates: the color, the line style, the mask', () => {
    check(FieldKinds.style, {
        'v·': { look: 'own default', items: 'clearValue', emptied: 'dropOwn' },
        'vA': { look: 'own value:given', items: 'openSource, noValue, clearToInherited', emptied: 'dropOwn' },
        'v-': { look: 'own noValue', items: 'openSource, clearToInherited', emptied: 'dropOwn' },
        '·A': { look: 'inherited value:given', items: 'openSource, writeInherited, noValue', emptied: 'nothing' },
        '-A': { look: 'own struck:given', items: 'openSource, followInherited', emptied: 'nothing' },
        '--': { look: 'own noValue', items: 'openSource, followInherited', emptied: 'nothing' },
        '-·': { look: 'own noValue', items: 'deleteKey', emptied: 'nothing' },
        '·-': { look: 'inherited noValue', items: 'openSource', emptied: 'nothing' },
        '··': { look: 'own default', items: '', emptied: 'nothing' },
    });
});

describe('FieldStates: a custom property, its conversions put after the inherited line', () => {
    check(FieldKinds.property, {
        'v·': { look: 'own noValue', items: 'toList, deleteKey', emptied: 'noValue' },
        'vA': { look: 'own value:given', items: 'openSource, toList, noValue, clearToInherited', emptied: 'dropOwn' },
        'v-': { look: 'own noValue', items: 'openSource, toList, clearToInherited', emptied: 'dropOwn' },
        '·A': { look: 'inherited value:given', items: 'openSource, toList, writeInherited, noValue', emptied: 'nothing' },
        '-A': { look: 'own struck:given', items: 'openSource, toList, followInherited', emptied: 'nothing' },
        '--': { look: 'own noValue', items: 'openSource, toList, followInherited', emptied: 'nothing' },
        '-·': { look: 'own noValue', items: 'toList, deleteKey', emptied: 'nothing' },
        '·-': { look: 'inherited noValue', items: 'openSource, toList', emptied: 'nothing' },
    }, ['toList']);

    it('greys the inherited line where the hub has none of the note to open, the menu keeping its shape', () => {
        const menu = FieldStates.menu(state('·A'), FieldKinds.property, { opensSource: false });
        expect(menu.items[0]).toEqual({ action: 'openSource', disabled: true });
        expect(menu.items.map(word)).toEqual(['openSource', 'writeInherited', 'noValue']);
    });
});

/** The rows of a note, as the index reads them. */
function rows(content: string) {
    const parsed = FileParsePipeline.parse('note.md', splitLines(content).lines, DEFAULT_SETTINGS, namesOutsideIndex('note.md'));
    return (name: string) => parsed.tasks.find(task => task.content === name)!;
}

describe('FieldStates: the task\'s fields read', () => {
    const task = rows([
        '---',
        'tv-color: red',
        '---',
        '## Dated',
        '- tv-start:: 2026-03-01 09:00',
        '- tv-due:: 2026-03-10 18:00',
        '- [ ] given',
        '- [ ] own date @2026-03-02>>2026-03-11',
        '### Hidden',
        '- tv-start::',
        '- tv-mask::',
        '- [ ] under hidden',
        '- [ ] own none',
        '    - tv-color::',
        '## Plain',
        '- [ ] due alone @>>2026-04-01',
        '- [ ] with time @>>2026-04-01T10:00',
    ].join('\n'));

    it('reads a start\'s date and its time as values of their own, each its own side over what is given', () => {
        expect(FieldStates.ofDate(task('given'), 'startDate')).toEqual({ own: { kind: 'none' }, inherited: { kind: 'value', value: '2026-03-01', source: 'section' } });
        expect(FieldStates.ofDate(task('own date'), 'startDate')).toEqual({ own: { kind: 'value', value: '2026-03-02' }, inherited: { kind: 'value', value: '2026-03-01', source: 'section' } });
        expect(FieldStates.ofDate(task('own date'), 'startTime')).toEqual({ own: { kind: 'none' }, inherited: { kind: 'value', value: '09:00', source: 'section' } });
    });

    it('reads a date a section hides with no value as no value given, its time too', () => {
        expect(FieldStates.ofDate(task('under hidden'), 'startDate')).toEqual({ own: { kind: 'none' }, inherited: { kind: 'noValue', source: 'section' } });
        expect(FieldStates.ofDate(task('under hidden'), 'startTime')).toEqual({ own: { kind: 'none' }, inherited: { kind: 'noValue', source: 'section' } });
    });

    it('reads the due\'s date and time as the one due', () => {
        expect(FieldStates.ofDate(task('own date'), 'dueDate')).toEqual(FieldStates.ofDate(task('own date'), 'dueTime'));
        expect(FieldStates.ofDate(task('given'), 'dueTime')).toEqual({ own: { kind: 'none' }, inherited: { kind: 'value', value: '2026-03-10T18:00', source: 'section' } });
    });

    it('leaves the time field of an own due with no time, with nothing inherited, with nothing in it', () => {
        expect(FieldStates.ofDate(task('due alone'), 'dueTime')).toEqual({ own: { kind: 'none' }, inherited: { kind: 'none' } });
        expect(FieldStates.ofDate(task('due alone'), 'dueDate').own).toEqual({ kind: 'value', value: '2026-04-01' });
        expect(FieldStates.ofDate(task('with time'), 'dueTime').own).toEqual({ kind: 'value', value: '2026-04-01T10:00' });
    });

    it('reads a style\'s own no value, and no value given', () => {
        expect(FieldStates.ofStyle(task('own none'), 'color')).toEqual({ own: { kind: 'noValue' }, inherited: { kind: 'value', value: 'red', source: 'file' } });
        expect(FieldStates.ofStyle(task('under hidden'), 'mask')).toEqual({ own: { kind: 'none' }, inherited: { kind: 'noValue', source: 'section' } });
        expect(FieldStates.ofStyle(task('given'), 'linestyle')).toEqual({ own: { kind: 'none' }, inherited: { kind: 'none' } });
    });
});
