import { describe, it, expect } from 'vitest';
import { bindField } from '../../../src/modals/form/bindField';
import { DateInput } from '../../../src/utils/values/DateValues';
import { optional, type Issue } from '../../../src/utils/values/Read';
import { FakeEl, asEl } from '../helpers/fakeDom';

/** A date field bound to a value held here, as the hub holds its row. */
function dateField(initial: string | undefined, opts: { refuse?: boolean } = {}) {
    const input = new FakeEl();
    input.value = initial ?? '';
    let value = initial;
    const commits: (string | undefined)[] = [];
    const said: (Issue | null)[] = [];
    const field = bindField(asEl(input), {
        codec: optional(DateInput),
        current: () => value,
        commit: (v) => {
            commits.push(v);
            if (opts.refuse) return false;
            value = v;
        },
        issues: (issue) => said.push(issue),
    });
    return { input, field, commits, said, last: () => said[said.length - 1], setValue: (v: string | undefined) => { value = v; } };
}

describe('bindField', () => {
    it('reads while typing and says what is wrong, writing nothing and keeping the text', () => {
        const f = dateField('2026-10-01');
        f.input.type('2026-02-30');
        expect(f.last()).toEqual({ code: 'noSuchDay' });
        expect(f.commits).toEqual([]);
        expect(f.input.value).toBe('2026-02-30');
        expect(f.field.pending()).toEqual({ ok: false, issue: { code: 'noSuchDay' } });
    });

    it('commits a blur once, the text shown as the value reads (論点 C), and not again on the next blur', () => {
        const f = dateField(undefined);
        f.input.type('２０２６ー１０ー０５');
        f.input.blur();
        expect(f.input.value).toBe('2026-10-05');
        expect(f.commits).toEqual(['2026-10-05']);
        expect(f.field.pending()).toBeNull();
        f.input.blur();
        f.input.enter();
        expect(f.commits).toEqual(['2026-10-05']);
    });

    it('commits on the form\'s Enter, and not on an IME\'s', () => {
        const f = dateField(undefined);
        f.input.type('2026-10-05');
        f.input.enter({ isComposing: true });
        f.input.enter({ keyCode: 229 });
        expect(f.commits).toEqual([]);
        f.input.enter();
        expect(f.commits).toEqual(['2026-10-05']);
    });

    it('keeps a text that does not read, said wrong and not committed (論点 E)', () => {
        const f = dateField('2026-10-01');
        f.input.type('明日');
        f.input.blur();
        expect(f.commits).toEqual([]);
        expect(f.input.value).toBe('明日');
        expect(f.last()).toEqual({ code: 'shape', kind: 'date' });
    });

    it('commits an empty field as no value', () => {
        const f = dateField('2026-10-01');
        f.input.type('');
        f.input.blur();
        expect(f.commits).toEqual([undefined]);
    });

    it('puts a value from outside with no event, and says nothing wrong of it', () => {
        const f = dateField('2026-10-01');
        let inputs = 0;
        f.input.addEventListener('input', () => { inputs++; });
        f.setValue('2026-10-09');
        f.field.set('2026-10-09');
        expect(f.input.value).toBe('2026-10-09');
        expect(inputs).toBe(0);
        expect(f.last()).toBeNull();
    });

    it('keeps text typed and not committed when a value comes from outside, and while the IME composes', () => {
        const f = dateField('2026-10-01');
        f.input.type('2026-10-0');
        f.field.set('2026-10-09');
        expect(f.input.value).toBe('2026-10-0');

        const g = dateField('2026-10-01');
        g.input.dispatchEvent(new Event('compositionstart'));
        g.field.set('2026-10-09');
        expect(g.input.value).toBe('2026-10-01');
        g.input.dispatchEvent(new Event('compositionend'));
        g.field.set('2026-10-09');
        expect(g.input.value).toBe('2026-10-09');
    });

    it('keeps the text a form refused as typed: a value from outside does not put it back', () => {
        const f = dateField('2026-10-01', { refuse: true });
        f.input.type('2026-09-01');
        f.input.blur();
        expect(f.commits).toEqual(['2026-09-01']);
        f.field.set('2026-10-01');
        expect(f.input.value).toBe('2026-09-01');
        expect(f.field.pending()).toEqual({ ok: true, value: '2026-09-01' });
    });

    it('keeps the text a write refused as typed, the form\'s value gone back: a value from outside does not put it back, and it commits again', async () => {
        const input = new FakeEl();
        input.value = '2026-10-01';
        let value: string | undefined = '2026-10-01';
        const commits: (string | undefined)[] = [];
        let answer!: (written: boolean) => void;
        const field = bindField(asEl(input), {
            codec: optional(DateInput),
            current: () => value,
            commit: (v) => {
                commits.push(v);
                value = v;
                return new Promise<boolean>(resolve => { answer = resolve; });
            },
            issues: () => { },
        });
        input.type('2026-09-01');
        input.blur();
        // The form went back to what the index holds, and the write is refused.
        value = '2026-10-01';
        answer(false);
        await Promise.resolve();
        field.set('2026-10-02');
        expect(input.value).toBe('2026-09-01');
        expect(field.pending()).toEqual({ ok: true, value: '2026-09-01' });
        input.enter();
        expect(commits).toEqual(['2026-09-01', '2026-09-01']);
        // Written this time: the next value from outside comes in.
        answer(true);
        await Promise.resolve();
        value = '2026-10-03';
        field.set('2026-10-03');
        expect(input.value).toBe('2026-10-03');
    });

    it('throws away what is typed on discard: the field shows its value, and says nothing', () => {
        const f = dateField('2026-10-01');
        f.input.type('2026-02-30');
        f.field.discard();
        expect(f.input.value).toBe('2026-10-01');
        expect(f.field.pending()).toBeNull();
        expect(f.last()).toBeNull();
        f.setValue('2026-10-09');
        f.field.set('2026-10-09');
        expect(f.input.value).toBe('2026-10-09');
    });

    it('settles a field whose text became its value (a group\'s other field wrote it) on commit, so a value from outside comes in', () => {
        const f = dateField('2026-10-01');
        f.input.type('2026-10-05');
        f.setValue('2026-10-05');
        f.input.blur();
        expect(f.commits).toEqual([]);
        f.setValue('2026-10-09');
        f.field.set('2026-10-09');
        expect(f.input.value).toBe('2026-10-09');
    });

    it('keeps the text while its write is under way, a value from outside put meanwhile (the form going back as the refusal comes) left out', async () => {
        const input = new FakeEl();
        input.value = '2026-10-01';
        let value: string | undefined = '2026-10-01';
        let answer!: (written: boolean) => void;
        const field = bindField(asEl(input), {
            codec: optional(DateInput),
            current: () => value,
            commit: (v) => {
                value = v;
                return new Promise<boolean>(resolve => { answer = resolve; });
            },
            issues: () => { },
        });
        input.type('2026-09-01');
        input.blur();
        // The form hears the refusal before the field does, and puts the index's value back.
        value = '2026-10-01';
        field.set('2026-10-01');
        expect(input.value).toBe('2026-09-01');
        answer(false);
        await Promise.resolve();
        field.set('2026-10-01');
        expect(input.value).toBe('2026-09-01');
        expect(field.pending()).toEqual({ ok: true, value: '2026-09-01' });
    });
});

