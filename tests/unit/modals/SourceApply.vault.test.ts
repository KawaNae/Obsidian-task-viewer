import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { VaultSession } from '../helpers/vaultSession';
import { openMoveHub, stubMoveHubGlobals, settle } from '../helpers/moveHub';

/**
 * The source opened on a row the note holds, out of a move (`SourceApply`),
 * with what is typed in the hub's fields: the host, the switch and the form
 * are real (`openMoveHub`), over a live vault. The seat saves what is typed
 * as a blur would before it opens, so the source opens on it; a value typed
 * that does not read stays in its field, and the source opens on the row as
 * the note holds it.
 */

const lives: VaultSession[] = [];
beforeAll(stubMoveHubGlobals);
afterAll(() => vi.unstubAllGlobals());
afterEach(() => { while (lives.length) lives.pop()!.dispose(); vi.restoreAllMocks(); });
const open = async () => {
    const h = await openMoveHub(s => { lives.push(s); });
    const writes = vi.spyOn(h.session.ops, 'updateTask');
    return { ...h, writes };
};

describe('the source entered with a field typed in, on a row', () => {
    it('writes the name typed once, and opens on it', async () => {
        const h = await open();
        const name = h.field('name');
        name.focus();
        name.type('Typed');

        await h.source.enter();
        await settle();

        expect(h.writes).toHaveBeenCalledTimes(1);
        expect(h.lines()[1]).toBe('- [ ] Typed @2026-11-26');
        expect(h.state().phase).toBe('source');
        expect(h.editor().parent).toBe('- [ ] Typed @2026-11-26');
    });

    it('writes the name once when the field was left before, as a Tab to the switch leaves it', async () => {
        const h = await open();
        const name = h.field('name');
        name.focus();
        name.type('Typed');
        name.blur();

        await h.source.enter();
        await settle();

        expect(h.writes).toHaveBeenCalledTimes(1);
        expect(h.editor().parent).toBe('- [ ] Typed @2026-11-26');
    });

    it('opens on the row as it is with a date typed that does not read: nothing written, the date kept typed and why said under it, back on the card and at a close', async () => {
        const h = await open();
        const start = h.field('start');
        start.focus();
        start.type('あした');

        await h.source.enter();
        await settle();

        expect(h.state().phase).toBe('source');
        expect(h.editor().parent).toBe('- [ ] Row @2026-11-26');
        expect(h.writes).not.toHaveBeenCalled();
        expect(h.lines()[1]).toBe('- [ ] Row @2026-11-26');

        h.source.back();
        await settle();

        expect(h.state().phase).toBe('view');
        expect(start.value).toBe('あした');
        expect(start.disabled).toBe(false);
        expect(h.root.findAll('tv-form__error').length).toBeGreaterThan(0);

        expect(h.form.beforeClose()).toBe('stay');
        expect(h.ask()).not.toBeNull();
        expect(h.writes).not.toHaveBeenCalled();
    });

    it('writes what reads and keeps what does not: the name typed written once and the source opened on it, the date kept typed', async () => {
        const h = await open();
        // Both typed and neither left: no blur writes before the switch.
        const start = h.field('start');
        start.type('あした');
        const name = h.field('name');
        name.focus();
        name.type('Typed');

        await h.source.enter();
        await settle();

        expect(h.writes).toHaveBeenCalledTimes(1);
        expect(h.lines()[1]).toBe('- [ ] Typed @2026-11-26');
        expect(h.state().phase).toBe('source');
        expect(h.editor().parent).toBe('- [ ] Typed @2026-11-26');

        h.source.back();
        await settle();
        expect(start.value).toBe('あした');
    });
});
