import { describe, it, expect } from 'vitest';
import { CreateDialog, placeText, type CreateHost, type CreateViewState } from '../../../src/modals/create/CreateDialog';
import type { CreatePlace, PlaceFacts } from '../../../src/services/data/CreatePlaces';
import type { IndexRefusal } from '../../../src/services/core/RefusalClause';
import { refusalText, type WriteAnswer } from '../../../src/services/operations/WriteAnswer';
import { t } from '../../../src/i18n';

const PLACE: CreatePlace = { kind: 'dailyNote', date: '2031-01-15' };
const SECTION = { heading: 'Tasks', level: 2, side: 'head' as const };

function daily(over: Partial<Extract<PlaceFacts, { kind: 'dailyNote' }>> = {}): PlaceFacts {
    return { kind: 'dailyNote', path: '2031-01-15.md', section: SECTION, note: 'existing', heading: { kind: 'none' }, ignored: false, inherits: {}, ...over };
}

const REFUSED: IndexRefusal = { file: '2031-01-15.md', reason: { kind: 'changed' }, subject: '2031-01-15.md' };

/** A dialog over a host whose answers the test gives, and what it drew and did. */
function rig(facts: PlaceFacts) {
    let answerFacts!: (facts: PlaceFacts) => void;
    let answerWrite!: (answer: WriteAnswer) => void;
    const lines: string[] = [];
    const late: IndexRefusal[] = [];
    let closed = 0;
    let asked = 0;
    const host: CreateHost = {
        facts: () => { asked++; return new Promise(resolve => { answerFacts = resolve; }); },
        create: (_place, line) => { lines.push(line); return new Promise(resolve => { answerWrite = resolve; }); },
        tellLate: (refused) => { late.push(refused); },
        close: () => { closed++; },
    };
    let drawn: CreateViewState | null = null;
    const dialog = new CreateDialog(PLACE, host, { render: (state) => { drawn = state; } });
    return {
        dialog,
        lines,
        late,
        closed: () => closed,
        asked: () => asked,
        drawn: () => drawn!,
        answerFacts: async (f: PlaceFacts = facts) => { answerFacts(f); await Promise.resolve(); await Promise.resolve(); },
        answerWrite: async (a: WriteAnswer) => { answerWrite(a); await Promise.resolve(); await Promise.resolve(); },
    };
}

describe('CreateDialog', () => {
    it('offers no create until the place has answered, and then says where the line goes', async () => {
        const r = rig(daily());
        expect(r.drawn().canCreate).toBe(false);
        await r.dialog.create({ content: 'x' });
        expect(r.lines).toEqual([]);

        await r.answerFacts();
        expect(r.drawn().canCreate).toBe(true);
        expect(r.drawn().issues).toEqual([{ at: 'form', tone: 'info', text: t('modal.newTask.toMade', { note: '2031-01-15.md', heading: 'Tasks' }) }]);
    });

    it('writes the entry as an unchecked line and closes once it is written', async () => {
        const r = rig(daily());
        await r.answerFacts();
        const made = r.dialog.create({ content: '電話', startDate: '2031-01-15', startTime: '10:00' });
        expect(r.drawn().phase).toBe('creating');
        expect(r.drawn().canCreate).toBe(false);
        await r.answerWrite({ written: true });
        await made;
        expect(r.lines).toEqual(['- [ ] 電話 @2031-01-15T10:00']);
        expect(r.closed()).toBe(1);
    });

    it('stays open over a write refused, says why above the buttons once, and asks the place again', async () => {
        const r = rig(daily());
        await r.answerFacts();
        const made = r.dialog.create({ content: '電話' });
        await r.answerWrite({ written: false, refused: REFUSED });
        await made;
        expect(r.closed()).toBe(0);
        expect(r.asked()).toBe(2);
        await r.answerFacts();
        const errors = r.drawn().issues.filter(issue => issue.tone === 'error');
        expect(errors).toEqual([{ at: 'form', tone: 'error', text: refusalText(REFUSED) }]);
        expect(r.drawn()).toMatchObject({ phase: 'open', canCreate: true });

        // Asked again, the last refusal is taken back.
        void r.dialog.create({ content: '電話' });
        expect(r.drawn().issues.some(issue => issue.tone === 'error')).toBe(false);
    });

    it('tells a refusal that comes after it closed by the host\'s notice', async () => {
        const r = rig(daily());
        await r.answerFacts();
        const made = r.dialog.create({ content: '電話' });
        r.dialog.dispose();
        await r.answerWrite({ written: false, refused: REFUSED });
        await made;
        expect(r.late).toEqual([REFUSED]);
        expect(r.closed()).toBe(0);
    });

    it('offers no create where the line has no one place: the heading twice, the row gone', async () => {
        for (const facts of [daily({ heading: { kind: 'many', count: 2 } }), { kind: 'gone', inherits: {} } as PlaceFacts]) {
            const r = rig(facts);
            await r.answerFacts();
            expect(r.drawn().canCreate).toBe(false);
            expect(r.drawn().issues[0].tone).toBe('error');
        }
    });

    it('reads a time with no date as a start only where the place gives a start date (論点1)', async () => {
        const plain = rig(daily());
        await plain.answerFacts();
        expect(plain.dialog.dateContext()).toEqual({ hasImplicitStartDate: false, implicitStartDate: undefined });

        const given = rig(daily({ inherits: { startDate: '2031-01-10' } }));
        await given.answerFacts();
        expect(given.dialog.dateContext()).toEqual({ hasImplicitStartDate: true, implicitStartDate: '2031-01-10' });
        expect(given.drawn().inherits).toEqual({ startDate: '2031-01-10' });
    });

    it('warns of a note the views do not read', async () => {
        const r = rig(daily({ ignored: true }));
        await r.answerFacts();
        expect(r.drawn().issues).toContainEqual({ at: 'form', tone: 'warning', text: t('modal.newTask.ignored', { note: '2031-01-15.md' }) });
        expect(r.drawn().canCreate).toBe(true);
    });
});

describe('placeText', () => {
    it('says each place by where the line goes', () => {
        const vars = { note: '2031-01-15.md', heading: 'Tasks' };
        expect(placeText(daily({ note: 'new', heading: { kind: 'one', heading: {} as never } }))).toEqual({ text: t('modal.newTask.toNew', vars), tone: 'info' });
        expect(placeText(daily({ heading: { kind: 'one', heading: {} as never } }))).toEqual({ text: t('modal.newTask.toHead', vars), tone: 'info' });
        expect(placeText(daily({ heading: { kind: 'one', heading: {} as never }, section: { ...SECTION, side: 'end' } }))).toEqual({ text: t('modal.newTask.toEnd', vars), tone: 'info' });
        expect(placeText({ kind: 'childOf', parent: '親', inherits: {} })).toEqual({ text: t('modal.newTask.toChild', { parent: '親' }), tone: 'info' });
    });
});
