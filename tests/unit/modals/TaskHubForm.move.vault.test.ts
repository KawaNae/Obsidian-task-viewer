import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { VaultSession } from '../helpers/vaultSession';
import { openMoveHub, stubMoveHubGlobals, settle, tick } from '../helpers/moveHub';
import { t } from '../../../src/i18n';
import type { SendResult } from '../../../src/services/data/NoteOps';
import type { FocusEl } from '../helpers/focusDom';

/**
 * The hub's form on a row the hub moves, with the source open on the move's
 * draft or not: what cancel and a close do while the move is under way,
 * when [Move] may be pressed while the source holds a text not taken in,
 * what the fields show of a value the draft did not take, and what of the
 * source's text is taken into the draft, and asked of. The host, the
 * move, the source mode and the form are real (`openMoveHub`).
 */

const lives: VaultSession[] = [];
beforeAll(stubMoveHubGlobals);
afterAll(() => vi.unstubAllGlobals());
afterEach(() => { while (lives.length) lives.pop()!.dispose(); vi.restoreAllMocks(); });
const open = (...args: Parameters<typeof openMoveHub> extends [unknown, ...infer R] ? R : never) => openMoveHub(s => { lives.push(s); }, ...args);

/** The send held until the test answers it. */
function holdSend(h: Awaited<ReturnType<typeof open>>) {
    let answer!: (result: SendResult | 'send') => void;
    const send = h.noteOps.send.bind(h.noteOps);
    vi.spyOn(h.noteOps, 'send').mockImplementationOnce((req, opts) => new Promise<SendResult | 'send'>(resolve => { answer = resolve; })
        .then(result => (result === 'send' ? send(req, opts) : result)));
    return { answer: (result: SendResult | 'send') => answer(result) };
}

describe('cancel and a close while the move is under way', () => {
    it('cancel throws nothing away: the move not made keeps the draft, where the row goes and the source\'s text, no question put', async () => {
        const h = await open();
        await h.begin();
        await h.toDone();
        await h.source.enter();
        h.editor().type({ children: [{ text: '- [ ] a2', was: 1 }, { text: '- [ ] b', was: 2 }] });
        const send = holdSend(h);
        h.click(h.act());
        await settle();
        expect(h.host.draft()!.writing()).toBe(true);
        h.click(h.cancelButton());
        await settle();
        expect(h.move()).not.toBeNull();
        expect(h.ask()).toBeNull();
        send.answer({ kind: 'not-done', why: 'not moved' });
        await tick(20);
        expect(h.closed()).toBe(false);
        expect(h.move()).not.toBeNull();
        expect(h.state().phase).toBe('source');
        expect(h.editor().draft().children[0].text).toBe('- [ ] a2');
        expect(h.host.task().subtreeLines).toEqual(['- [ ] Row @2026-11-26', '    - [ ] a2', '    - [ ] b']);
        expect(h.move()!.changed()).toBe(true);
        expect(h.lines()[1]).toBe('- [ ] Row @2026-11-26');
    });

    it('cancel asked while it is under way, the move made closes the hub, as a close asked then', async () => {
        const h = await open();
        await h.begin();
        await h.toDone();
        const send = holdSend(h);
        h.click(h.act());
        await settle();
        h.click(h.cancelButton());
        await settle();
        send.answer('send');
        await tick(20);
        expect(h.closed()).toBe(true);
        expect(h.lines()).toEqual(['# Tasks', '# Done', '- [ ] Row @2026-11-26', '    - [ ] a', '    - [ ] b', '- [ ] Other', '']);
    });

    it('a close asked while it is under way and the move not made stays, the move kept', async () => {
        const h = await open();
        await h.begin();
        await h.toDone();
        const send = holdSend(h);
        h.click(h.act());
        await settle();
        h.form.beforeClose();
        send.answer({ kind: 'not-done', why: 'not moved' });
        await tick(20);
        expect(h.closed()).toBe(false);
        expect(h.move()).not.toBeNull();
    });
});

describe('[Move] while the source holds a text not taken in', () => {
    /** The timers keep a send whose row has no child `a` from being made. */
    const keepsA = (h: Awaited<ReturnType<typeof open>>) => h.setTimers(sending => (
        sending.from.some(note => !note.sent.some(line => line.trim() === '- [ ] a')) ? 'a timer keeps a' : null));

    it('refused by the timers on the text taken in, may be pressed again once the text is typed back, and moves it', async () => {
        const h = await open();
        await h.begin();
        await h.toDone();
        keepsA(h);
        await h.source.enter();
        h.editor().type({ children: [{ text: '- [ ] b', was: 2 }] });
        expect(h.act().disabled).toBe(false);
        h.click(h.act());
        await tick(20);
        expect(h.closed()).toBe(false);
        expect(h.host.draft()!.canWrite()).toBe(false);
        expect(h.act().disabled).toBe(true);
        h.editor().type({ children: [{ text: '- [ ] a', was: 1 }, { text: '- [ ] b', was: 2 }] });
        expect(h.act().disabled).toBe(false);
        h.click(h.act());
        await tick(20);
        expect(h.closed()).toBe(true);
        expect(h.lines()).toEqual(['# Tasks', '# Done', '- [ ] Row @2026-11-26', '    - [ ] a', '    - [ ] b', '- [ ] Other', '']);
    });

    it('says why the timers keep the text taken in where it says it out of the source, and not while a text is not taken in', async () => {
        const h = await open();
        await h.begin();
        await h.toDone();
        keepsA(h);
        await h.source.enter();
        h.editor().type({ children: [{ text: '- [ ] b', was: 2 }] });
        h.click(h.act());
        await tick(20);
        const said = () => h.move()!['shown']!.issues.filter(issue => issue.at === 'form').map(issue => issue.text);
        expect(said()).toContain('a timer keeps a');
        h.editor().type({ children: [{ text: '- [ ] b2', was: 2 }] });
        expect(said()).not.toContain('a timer keeps a');
    });

    it('with nothing not taken in, is as the draft says: refused by the timers, not pressed', async () => {
        const h = await open();
        await h.begin();
        await h.toDone();
        keepsA(h);
        await h.source.enter();
        h.editor().type({ children: [{ text: '- [ ] b', was: 2 }] });
        h.source.back();
        expect(h.act().disabled).toBe(true);
    });
});

/** A row with a property written twice: the draft refuses a change of it. */
const TWICE = ['# Tasks', '- [ ] Row', '    - area:: a', '    - area:: b', '# Done', ''];

/** The add row's key and value fields. */
const addRow = (h: Awaited<ReturnType<typeof open>>) => h.root.find('task-hub__prop-add')!.findAll('tv-ctrl__text-input') as FocusEl[];

/** Type `key` and `value` in the add row, and leave it for the name: the draft refuses it. */
async function addRefused(h: Awaited<ReturnType<typeof open>>, key = 'area', value = 'zz') {
    const [keyInput, valueInput] = addRow(h);
    keyInput.focus();
    keyInput.type(key);
    valueInput.focus();
    valueInput.type(value);
    h.field('name').focus();
    await settle();
}

describe('the values the fields show while the row moves', () => {
    it('a value the draft refused is said refused, once the source took a text in as well', async () => {
        const h = await open(TWICE);
        await h.begin();
        await addRefused(h);
        expect(h.formSays().some(text => text.includes('area'))).toBe(true);
        await h.source.enter();
        h.editor().type({ children: [{ text: '- area:: a', was: 1 }, { text: '- area:: b', was: 2 }, { text: '- [ ] c', was: null }] });
        h.root.focus();
        h.source.back();
        await settle();
        const [keyInput, valueInput] = addRow(h);
        expect([keyInput.value, valueInput.value]).toEqual(['area', 'zz']);
        expect(h.formSays().some(text => text.includes('area'))).toBe(true);
    });

    it('a value the draft refused is put in again once the source mends what refused it', async () => {
        const h = await open(TWICE);
        await h.begin();
        await addRefused(h);
        await h.source.enter();
        h.editor().type({ children: [{ text: '- area:: a', was: 1 }] });
        h.root.focus();
        h.source.back();
        await settle();
        expect(h.host.task().subtreeLines).toEqual(['- [ ] Row', '    - area:: zz']);
        expect(h.formSays().some(text => text.includes('area'))).toBe(false);
    });

    it('a value the draft refused is said refused once another field\'s change is taken', async () => {
        const h = await open(TWICE);
        await h.begin();
        await addRefused(h);
        const name = h.field('name');
        name.focus();
        name.type('Row2');
        h.field('start').focus();
        await settle();
        expect(h.host.task().content).toBe('Row2');
        expect(h.formSays().some(text => text.includes('area'))).toBe(true);
    });

    it('cancel asks of a value the draft refused, and thrown away the fields show the index\'s row, which a blur writes nothing of', async () => {
        const h = await open(TWICE);
        await h.begin();
        await addRefused(h);
        h.click(h.cancelButton());
        await settle();
        expect(h.ask()).toBe(t('modal.hub.move.discardAsk'));
        expect(h.move()).not.toBeNull();
        h.click(h.foot.find('tv-form__discard'));
        await settle();
        expect(h.move()).toBeNull();
        const [keyInput, valueInput] = addRow(h);
        expect([keyInput.value, valueInput.value]).toEqual(['', '']);
        expect(h.formSays()).toEqual([]);
        keyInput.focus();
        h.field('name').focus();
        await tick(60);
        expect(h.lines()).toEqual(TWICE);
    });

    it('thrown away with the source open, a value the draft refused goes too', async () => {
        const h = await open(TWICE);
        await h.begin();
        await addRefused(h);
        await h.source.enter();
        h.click(h.cancelButton());
        await settle();
        h.click(h.foot.find('tv-form__discard'));
        await settle();
        expect(h.move()).toBeNull();
        const [keyInput, valueInput] = addRow(h);
        expect([keyInput.value, valueInput.value]).toEqual(['', '']);
    });

    it('a name the draft refused is shown as the index\'s once the move is thrown away', async () => {
        const h = await open();
        await h.begin();
        const move = h.move()!;
        const put = move.put.bind(move);
        vi.spyOn(move, 'put').mockImplementation((updates) => {
            if (updates.content !== undefined) {
                move['deps'].host.refuse('the name is refused');
                return false;
            }
            return put(updates);
        });
        const name = h.field('name');
        name.focus();
        name.type('Typed');
        h.field('start').focus();
        await settle();
        expect(h.formSays()).toContain('the name is refused');
        h.click(h.cancelButton());
        await settle();
        h.click(h.foot.find('tv-form__discard'));
        await settle();
        expect(h.move()).toBeNull();
        expect(name.value).toBe('Row');
        name.focus();
        h.field('start').focus();
        await tick(60);
        expect(h.lines()[1]).toBe('- [ ] Row @2026-11-26');
    });
});

describe('the source\'s text and the draft', () => {
    it('a child changed in place, as many lines as before, is a text not taken in: cancel asks of it', async () => {
        const h = await open();
        await h.begin();
        await h.source.enter();
        h.editor().type({ children: [{ text: '- [ ] a changed', was: 1 }, { text: '- [ ] b', was: 2 }] });
        h.click(h.cancelButton());
        await settle();
        expect(h.ask()).toBe(t('modal.hub.move.discardAsk'));
        expect(h.move()).not.toBeNull();
    });

    it('opens on the draft once what is typed in a field is put in, and takes its text in on that', async () => {
        const h = await open();
        await h.begin();
        const name = h.field('name');
        name.focus();
        name.type('Typed');
        await h.source.enter();
        expect(h.editor().frame.parent).toBe('- [ ] Typed @2026-11-26');
        h.editor().type({ children: [{ text: '- [ ] a', was: 1 }] });
        expect(() => h.source.back()).not.toThrow();
        expect(h.state().phase).toBe('view');
        expect(h.host.task().subtreeLines).toEqual(['- [ ] Typed @2026-11-26', '    - [ ] a']);
    });

    it('a text typed back to what it opened on, after another was taken in, is not taken in yet: cancel asks of it', async () => {
        const h = await open();
        await h.begin();
        await h.host.put({ content: 'X' });
        await h.source.enter();
        const opened = h.editor().draft();
        h.editor().type({ parent: opened.parent.replace('X', 'Row') });
        expect(h.move()!.seat.take()).toBe(true);
        h.editor().type({ parent: opened.parent });
        h.click(h.cancelButton());
        await settle();
        expect(h.ask()).toBe(t('modal.hub.move.discardAsk'));
    });

    it('says nothing under the editor once a text that did not take is mended and taken in, the move not made', async () => {
        const h = await open();
        await h.begin();
        await h.toDone();
        await h.source.enter();
        h.editor().type({ parent: 'just text' });
        h.click(h.act());
        await settle();
        expect(h.sourceSays()).toBe(t('modal.hub.source.notTask'));
        h.editor().type({ parent: '- [ ] Row @2026-11-26' });
        vi.spyOn(h.noteOps, 'send').mockResolvedValueOnce({ kind: 'not-done', why: 'not moved' });
        h.click(h.act());
        await tick(20);
        expect(h.state().phase).toBe('source');
        expect(h.sourceSays()).toBeNull();
    });

    it('thrown away on a row lost meanwhile, the switch says the row is gone', async () => {
        const h = await open();
        await h.begin();
        await h.source.enter();
        await h.writeOutside(['# Tasks', '# Done', '- [ ] Other', '']);
        h.click(h.cancelButton());
        await settle();
        h.click(h.foot.find('tv-form__discard'));
        await settle();
        expect(h.move()).toBeNull();
        expect(h.state().shut).toBe(t('modal.hub.taskMissing'));
    });
});
