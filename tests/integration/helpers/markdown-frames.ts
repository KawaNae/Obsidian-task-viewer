import { PRELUDE, SETTLE_MS, ev } from './view-helper';

/**
 * The markdown frames of a view's sidebar, read in the running Dev vault,
 * and the notes a test writes for them, all under the test's own prefix.
 * `markdown-frames.test.ts` and `markdown-frames-dialog.test.ts` share it.
 */

export interface StoredFrame {
    kind?: string;
    id: string;
    link?: string;
}

export interface Frame {
    id: string;
    name: string | null;
    collapsed: boolean;
    /** Whether the card is displayed. */
    shown: boolean;
    /** The body's text; null when the card holds no body. */
    text: string | null;
    /** The body's element has the mark `mark()` put on it; null when the card holds no body. */
    kept: boolean | null;
    color: string | null;
    linestyle: string | null;
    /** What the card says is not there; null when the section is found. */
    missing: string | null;
    /** The mask the card shows in place of the body; null when it shows none. */
    mask: string | null;
}

export interface Reading {
    sidebar: StoredFrame[];
    collapsed: Record<string, boolean>;
    /** The ids of the frames in the order the panel stacks them, lists and markdown frames. */
    order: string[];
    frames: Record<string, Frame>;
    /** The count the list frame shows. */
    listCount: number | null;
    /** Whether the panel says that nothing is added. */
    empty: boolean;
    /** Whether the view masks. */
    maskMode: boolean;
}

/** The notes under `prefix`, written, renamed and deleted through the vault. A path that is not under it is refused. */
export function notesUnder(prefix: string): string {
    return `
        const own = (path) => { if (!path.startsWith(${JSON.stringify(prefix)})) throw new Error('not a note of the test: ' + path); return path; };
        const noteAt = (path) => app.vault.getAbstractFileByPath(own(path));
        const writeNote = async (path, content) => {
            const f = noteAt(path);
            if (f) await app.vault.modify(f, content); else await app.vault.create(path, content);
        };
        const renameNote = (from, to) => app.fileManager.renameFile(noteAt(from), own(to));
        const deleteNote = async (path) => { const f = noteAt(path); if (f) await app.vault.delete(f); };
    `;
}

/** What a snippet run in the view `name` has, besides the prelude's: the view's markdown frames, and the notes under `prefix`. */
export function framesOf(prefix: string, name: string): string {
    return `
        ${PRELUDE}
        ${notesUnder(prefix)}
        const el = V(${JSON.stringify(name)}).contentEl;
        const C = { root: 'markdown-frame', header: 'sidebar-frame__header' };
        const frame = (id) => {
            const f = el.querySelector('.markdown-frame[data-frame-id="' + id + '"]');
            if (!f) throw new Error('no frame ' + id);
            return f;
        };
        const bodyOf = (id) => frame(id).querySelector('.markdown-frame__content');
        const mark = () => el.querySelectorAll('.markdown-frame__content').forEach(b => { b.__tvE2EMark = true; });
        const openMenu = async (id) => { headerBtn(C, frame(id), 'more-horizontal').click(); await wait(100); };
        // Turn the view's masking on or off from its toolbar, as the user does.
        const setMask = (on) => {
            const btn = el.querySelector('.view-toolbar__btn--icon[aria-pressed]');
            if ((btn.getAttribute('aria-pressed') === 'true') !== on) btn.click();
        };
    `;
}

/** Run `body` in the view `name`, and read its frames once drawn. */
export function readFrames(prefix: string, name: string, body: string, settleMs = SETTLE_MS): Reading {
    return ev<Reading>(`(async () => {
        ${framesOf(prefix, name)}
        ${body}
        await wait(${settleMs});
        const state = V(${JSON.stringify(name)}).getState();
        const text = (n) => n.textContent.replace(/\\s+/g, ' ').trim();
        const frames = {};
        for (const f of el.querySelectorAll('.markdown-frame')) {
            const card = f.querySelector('.markdown-frame__card');
            const body = f.querySelector('.markdown-frame__content');
            frames[f.dataset.frameId] = {
                id: f.dataset.frameId,
                name: f.querySelector('.sidebar-frame__name')?.textContent ?? null,
                collapsed: f.classList.contains('markdown-frame--collapsed'),
                shown: getComputedStyle(card).display !== 'none',
                text: body ? text(body) : null,
                kept: body ? body.__tvE2EMark === true : null,
                color: card.style.getPropertyValue('--file-accent') || null,
                linestyle: card.dataset.fileLinestyle ?? null,
                missing: f.querySelector('.markdown-frame__missing-reason')?.textContent ?? null,
                mask: f.querySelector('.markdown-frame__mask')?.textContent ?? null,
            };
        }
        const count = el.querySelector('.pinned-list .pinned-list__count')?.textContent;
        return JSON.stringify({
            sidebar: state.sidebar ?? [],
            collapsed: state.sidebarCollapsed ?? {},
            order: [...el.querySelector('.tv-sidebar__frames').children].map(c => c.dataset.frameId ?? c.dataset.listId ?? c.className),
            frames,
            listCount: count ? Number(count.replace(/[()]/g, '')) : null,
            empty: !!el.querySelector('.tv-sidebar__frames--empty'),
            maskMode: state.maskMode ?? false,
        });
    })()`);
}

/** The links the state of `r` holds for its markdown frames, by frame id. */
export function frameLinks(r: Reading): Record<string, string | undefined> {
    return Object.fromEntries(r.sidebar.filter(f => f.kind === 'markdown').map(f => [f.id, f.link]));
}

/**
 * Delete the notes under `prefix` the vault still has, and its folders, the
 * deepest first. A note deleted off the disk (`deleteTestFile`) may still
 * be listed by the vault for a moment: it is left to the vault to drop.
 */
export function deleteNotesUnder(prefix: string): void {
    ev(`(async () => {
        for (const f of app.vault.getMarkdownFiles()) {
            if (f.path.startsWith(${JSON.stringify(prefix)}) && await app.vault.adapter.exists(f.path)) await app.vault.delete(f);
        }
        const folders = app.vault.getAllLoadedFiles()
            .filter(f => f.children && f.path.startsWith(${JSON.stringify(prefix)}))
            .sort((a, b) => b.path.length - a.path.length);
        for (const f of folders) await app.vault.delete(f, true);
        return JSON.stringify(true);
    })()`);
}
