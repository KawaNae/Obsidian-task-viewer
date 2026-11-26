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

    it('drawn again as a text not taken in is typed back to what the draft holds: not pressed again, as the timers refuse the draft', async () => {
        const h = await open();
        await h.begin();
        await h.toDone();
        keepsA(h);
        await h.source.enter();
        h.editor().type({ children: [{ text: '- [ ] b', was: 2 }] });
        h.source.back();
        expect(h.act().disabled).toBe(true);
        await h.source.enter();
        const taken = h.editor().draft();
        h.editor().type({ children: [{ text: '- [ ] b2', was: 1 }] });
        expect(h.act().disabled).toBe(false);
        h.editor().type({ children: taken.children });
        expect(h.act().disabled).toBe(true);
    });
});

/** A row with a property written twice: the draft refuses a change of it. */
const TWICE = ['# Tasks', '- [ ] Row', '    - area:: a', '    - area:: b', '# Done', ''];
/** {@link TWICE} with a property the draft takes changes of. */
const TWICE_X = ['# Tasks', '- [ ] Row', '    - area:: a', '    - area:: b', '    - x:: 1', '# Done', ''];

type Hub = Awaited<ReturnType<typeof open>>;

/** The add row's key and value fields. */
const addRow = (h: Hub) => h.root.find('task-hub__prop-add')!.findAll('tv-ctrl__text-input') as FocusEl[];

/** What is said under the fields, the form's own place left out. */
const rowSays = (h: Hub) => h.root.findAll('tv-form__says')
    .filter(says => !says.classes.has('tv-form__says--form'))
    .flatMap(says => says.children.map(child => child.text));

/** The draft's refusal of a change of `area`, told by one of its two lines under the row. */
const AREA_REFUSED = ['1', '2'].map(line => t('modal.hub.move.refusedProperty', { key: 'area', line }));

/** Whether the draft's refusal of a change of `area` is said under a field (beside the finding of its key written twice). */
const saysArea = (h: Hub) => rowSays(h).some(text => AREA_REFUSED.includes(text));

/** The element the focus is on. */
const focused = (h: Hub) => (h.root as unknown as { ownerDocument: { activeElement: unknown } }).ownerDocument.activeElement;

/** Type `key` and `value` in the add row, and leave it for the name: the draft refuses it. */
async function addRefused(h: Hub, key = 'area', value = 'zz') {
    const [keyInput, valueInput] = addRow(h);
    keyInput.focus();
    keyInput.type(key);
    valueInput.focus();
    valueInput.type(value);
    h.field('name').focus();
    await settle();
}

/** The draft refuses every change of the name, saying `why`. */
function refuseName(h: Hub, why = 'the name is refused') {
    const move = h.move()!;
    const put = move.put.bind(move);
    vi.spyOn(move, 'put').mockImplementation((updates) => {
        if (updates.content !== undefined) {
            move['deps'].host.refuse(why);
            return false;
        }
        return put(updates);
    });
}

describe('a change the draft refuses while the row moves', () => {
    it('empties the add row and says why under it, the focus where it went', async () => {
        const h = await open(TWICE);
        await h.begin();
        await addRefused(h);
        const [keyInput, valueInput] = addRow(h);
        expect([keyInput.value, valueInput.value]).toEqual(['', '']);
        expect(saysArea(h)).toBe(true);
        expect(h.formSays()).toEqual([]);
        expect(focused(h)).toBe(h.field('name'));
        expect(h.host.task().subtreeLines).toEqual(['- [ ] Row', '    - area:: a', '    - area:: b']);
    });

    it('committed by Enter in the add row, leaves the focus in the add row\'s field it was in', async () => {
        const h = await open(TWICE);
        await h.begin();
        const [keyInput, valueInput] = addRow(h);
        keyInput.focus();
        keyInput.type('area');
        valueInput.focus();
        valueInput.type('zz');
        valueInput.enter();
        await settle();
        const [keyNow, valueNow] = addRow(h);
        expect([keyNow.value, valueNow.value]).toEqual(['', '']);
        expect(focused(h)).toBe(valueNow);
        expect(saysArea(h)).toBe(true);
    });

    it('shows the draft\'s value in a field it refused, the field keeping the focus Enter left in it', async () => {
        const h = await open();
        await h.begin();
        refuseName(h);
        const name = h.field('name');
        name.focus();
        name.type('Typed');
        name.enter();
        await settle();
        expect(name.value).toBe('Row');
        expect(focused(h)).toBe(name);
        expect(rowSays(h)).toContain('the name is refused');
    });

    it('says why under each field it refused, until the draft changes', async () => {
        const h = await open(TWICE);
        await h.begin();
        refuseName(h);
        await addRefused(h);
        const name = h.field('name');
        name.type('Typed');
        h.field('start').focus();
        await settle();
        expect(name.value).toBe('Row');
        expect(rowSays(h)).toContain('the name is refused');
        expect(saysArea(h)).toBe(true);
        const start = h.field('start');
        start.type('2026-11-28');
        h.field('end').focus();
        await settle();
        expect(h.host.task().startDate).toBe('2026-11-28');
        expect(rowSays(h)).not.toContain('the name is refused');
        expect(saysArea(h)).toBe(false);
    });

    it('leaves another field\'s change, taken by Enter after a refusal, with the focus in its field', async () => {
        const h = await open(TWICE_X);
        await h.begin();
        await addRefused(h);
        const x = h.field('property:x');
        x.focus();
        x.type('2');
        x.enter();
        await settle();
        expect(h.host.task().subtreeLines).toEqual(['- [ ] Row', '    - area:: a', '    - area:: b', '    - x:: 2']);
        expect(focused(h)).toBe(x);
        expect(h.field('property:x')).toBe(x);
    });

    it('puts in no text another field holds typed when a change is taken', async () => {
        const h = await open();
        await h.begin();
        const name = h.field('name');
        name.focus();
        name.type('Typed');
        await h.host.put({ startDate: '2026-11-27' });
        await settle();
        expect(h.host.task().content).toBe('Row');
        expect(name.value).toBe('Typed');
        expect(focused(h)).toBe(name);
    });

    it('is not put in by [Move] once the source mends what refused it: the move writes the draft as it holds it', async () => {
        const h = await open(TWICE);
        await h.begin();
        await h.toDone();
        await addRefused(h);
        await h.source.enter();
        h.editor().type({ children: [{ text: '- area:: a', was: 1 }] });
        h.click(h.act());
        await tick(30);
        expect(h.closed()).toBe(true);
        expect(h.lines()).toEqual(['# Tasks', '# Done', '- [ ] Row', '    - area:: a', '']);
    });

    it('is no loss that cancel asks of: cancel throws the move away at once, and a blur writes nothing after', async () => {
        const h = await open(TWICE);
        await h.begin();
        await addRefused(h);
        h.click(h.cancelButton());
        await settle();
        expect(h.ask()).toBeNull();
        expect(h.move()).toBeNull();
        expect(saysArea(h)).toBe(false);
        expect(h.formSays()).toEqual([]);
        const [keyInput] = addRow(h);
        keyInput.focus();
        h.field('name').focus();
        await tick(60);
        expect(h.lines()).toEqual(TWICE);
    });

    it('is said no more once the source takes a text in, the fields showing the draft', async () => {
        const h = await open(TWICE);
        await h.begin();
        await addRefused(h);
        await h.source.enter();
        h.editor().type({ children: [{ text: '- area:: a', was: 1 }, { text: '- area:: b', was: 2 }, { text: '- [ ] c', was: null }] });
        h.root.focus();
        h.source.back();
        await settle();
        const [keyInput, valueInput] = addRow(h);
        expect([keyInput.value, valueInput.value]).toEqual(['', '']);
        expect(saysArea(h)).toBe(false);
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

describe('the move thrown away', () => {
    /** A row with a list of its own, in a section whose list it inherits. */
    const LISTS = ['# Tasks', '- area::', '    - lab', '    - desk', '- [ ] Row @2026-11-26', '    - l::', '        - p', '# Done', ''];

    /** The property row labelled `key`. */
    const rowOf = (h: Hub, key: string) => h.root.findAll('tv-form__row').find(row => row.find('tv-form__label')?.children.some(c => c.text === key));

    it('shows the index\'s row in every field that held a text it could not save, and says nothing of them', async () => {
        const h = await open(LISTS, { rowName: 'Row' });
        await h.begin();
        const typeIn = (el: FocusEl, text: string) => { el.focus(); el.type(text); };
        typeIn(h.field('start'), '明日');
        typeIn(h.field('linestyle'), 'wavy');
        typeIn(h.field('tags'), 'a#b');
        const listAdd = h.field('property:l');
        typeIn(listAdd, 'a:: b');
        h.click(h.cancelButton());
        await settle();
        expect(h.ask()).toBe(t('modal.hub.move.discardAsk'));
        h.click(h.foot.find('tv-form__discard'));
        await settle();
        expect(h.move()).toBeNull();
        expect(h.field('start').value).toBe('2026-11-26');
        expect(h.field('linestyle').value).toBe('');
        expect(h.field('tags').value).toBe('');
        expect(h.field('property:l').value).toBe('');
        expect(rowSays(h)).toEqual([]);
    });

    it('on a row lost meanwhile, throws away the text of a field the lost row shuts', async () => {
        const h = await open();
        await h.begin();
        const start = h.field('start');
        start.focus();
        start.type('明日');
        await h.writeOutside(['# Tasks', '# Done', '- [ ] Other', '']);
        h.click(h.cancelButton());
        await settle();
        h.click(h.foot.find('tv-form__discard'));
        await settle();
        expect(h.move()).toBeNull();
        expect(h.state().shut).toBe(t('modal.hub.taskMissing'));
        expect(start.value).toBe('2026-11-26');
    });

    it('lets go of an inherited list made the row\'s own and not written yet: the inherited list shows again', async () => {
        const h = await open(LISTS, { rowName: 'Row' });
        await h.begin();
        h.click(rowOf(h, 'area')!.find('task-hub__make-own')!);
        expect(rowOf(h, 'area')!.find('task-hub__make-own')).toBeNull();
        h.click(h.cancelButton());
        await settle();
        expect(h.move()).toBeNull();
        expect(rowOf(h, 'area')!.find('task-hub__make-own')).not.toBeNull();
    });
});
