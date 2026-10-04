import { describe, it, expect } from 'vitest';
import { IssueBoard } from '../../../src/modals/form/FormIssue';
import { FakeEl, asEl } from '../helpers/fakeDom';

type F = 'startDate' | 'endDate' | 'propKey';

/** A form of three fields, each its input and the line under its row, and the form's own place. */
function form() {
    const fields = {
        startDate: { input: new FakeEl('tv-ctrl__text-input'), message: new FakeEl() },
        endDate: { input: new FakeEl('tv-ctrl__text-input'), message: new FakeEl() },
        propKey: { input: new FakeEl('tv-ctrl__input-wrap'), message: new FakeEl() },
    };
    let shown: Set<F> = new Set(['startDate', 'endDate', 'propKey']);
    const formEl = new FakeEl();
    const board = new IssueBoard<F>({
        field: (at) => (shown.has(at) ? { input: asEl(fields[at].input), message: asEl(fields[at].message) } : null),
        form: asEl(formEl),
    });
    return { board, fields, formEl, hide: (at: F) => { shown = new Set([...shown].filter(f => f !== at)); } };
}

describe('IssueBoard', () => {
    it('says an issue under its field and marks the field of an error', () => {
        const f = form();
        f.board.set('dates', [{ at: 'endDate', tone: 'error', text: '終了日が開始日より前です。' }]);
        expect(f.fields.endDate.message.lines()).toEqual(['error: 終了日が開始日より前です。']);
        expect(f.fields.endDate.input.classes.has('tv-ctrl__text-input--invalid')).toBe(true);
        expect(f.fields.endDate.input.attrs.get('aria-invalid')).toBe('true');
        expect(f.board.has('error', 'endDate')).toBe(true);
    });

    it('replaces only what one source said: the dates set again keep the reserved key', () => {
        const f = form();
        f.board.set('propKey', [{ at: 'propKey', tone: 'error', text: '予約されたキーです。' }]);
        f.board.set('dates', [{ at: 'startDate', tone: 'error', text: '実在しない日付です。' }]);
        f.board.set('dates', []);
        expect(f.fields.propKey.message.lines()).toEqual(['error: 予約されたキーです。']);
        expect(f.fields.propKey.input.classes.has('tv-ctrl__input-wrap--invalid')).toBe(true);
        expect(f.fields.startDate.message.lines()).toEqual([]);
        expect(f.fields.startDate.input.classes.has('tv-ctrl__text-input--invalid')).toBe(false);
        expect(f.fields.startDate.input.attrs.has('aria-invalid')).toBe(false);

        f.board.set('propKey', []);
        expect(f.fields.propKey.message.lines()).toEqual([]);
        expect(f.board.has('error')).toBe(false);
    });

    it('says the same issue of two of a row once, every issue of a source, and marks no field of a warning or an info', () => {
        const f = form();
        const shared = f.fields.endDate.message;
        f.fields.startDate.message = shared;
        f.board.set('rows', [
            { at: 'startDate', tone: 'warning', text: '同じ理由' },
            { at: 'endDate', tone: 'warning', text: '同じ理由' },
            { at: 'endDate', tone: 'info', text: '別の文' },
        ]);
        expect(shared.lines()).toEqual(['warning: 同じ理由', 'info: 別の文']);
        expect(f.fields.endDate.input.classes.has('tv-ctrl__text-input--invalid')).toBe(false);
    });

    it('says an issue of the form, and one of a field that has no place now, in the form\'s place', () => {
        const f = form();
        f.hide('propKey');
        f.board.set('shut', [{ at: 'form', tone: 'warning', text: 'ソースの編集中です。' }]);
        f.board.set('propKey', [{ at: 'propKey', tone: 'error', text: '予約されたキーです。' }]);
        expect(f.formEl.lines()).toEqual(['warning: ソースの編集中です。', 'error: 予約されたキーです。']);
    });

    it('draws again in the slots a field has now, once its row was built anew', () => {
        const f = form();
        f.board.set('propKey', [{ at: 'propKey', tone: 'error', text: '予約されたキーです。' }]);
        const old = f.fields.propKey;
        f.fields.propKey = { input: new FakeEl('tv-ctrl__input-wrap'), message: new FakeEl() };
        f.board.redraw();
        expect(f.fields.propKey.message.lines()).toEqual(['error: 予約されたキーです。']);
        expect(f.fields.propKey.input.classes.has('tv-ctrl__input-wrap--invalid')).toBe(true);
        expect(old.message.lines()).toEqual([]);
    });
});
