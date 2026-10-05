import { obsidianEval, sleep } from './cli-helper';
import en from '../../../src/i18n/locales/en.json';
import ja from '../../../src/i18n/locales/ja.json';

/**
 * Drive the plugin's views in the running Dev vault through `obsidian eval`.
 *
 * Each test opens its views in leaves of its own, kept under a name in
 * `window.__tvE2E`, so the views the vault already has are never touched;
 * `closeViews` detaches them. A view is read through its DOM and the state
 * it saves (`getState`), as the workspace and a restart see it.
 */

/** Evaluate `code` in the vault; throw what it threw. */
export function ev<T>(code: string): T {
    const result = obsidianEval(code);
    if (result && typeof result === 'object' && 'error' in (result as object)) {
        throw new Error(`eval failed: ${(result as { error: string }).error}`);
    }
    return result as T;
}

/** What every evaluated snippet starts with. */
export const PRELUDE = `
    const P = app.plugins.plugins['obsidian-task-viewer'];
    const R = (window.__tvE2E ??= {});
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const V = (name) => { const l = R[name]; if (!l) throw new Error('no view ' + name); return l.view; };
    const read = (name) => {
        const v = V(name);
        const el = v.contentEl;
        const all = (sel) => [...el.querySelectorAll(sel)];
        const type = v.getViewType();
        const out = { type, state: v.getState(), today: !!el.querySelector('.is-today') };
        if (type === 'timeline-view') out.dates = all('.timeline-scroll-area__day-column').map(c => c.dataset.date);
        if (type === 'schedule-view') out.dates = all('.date-header .date-header__cell').map(c => c.dataset.date).filter(Boolean);
        if (type === 'mini-calendar-view') {
            out.dates = all('.cal-day-cell--mini').map(c => c.dataset.date);
            out.gridStart = v.gridRange().start;
        }
        if (type === 'calendar-view') {
            out.labels = all('.cal-day-cell .cal-day-cell__date-label').map(s => s.textContent);
            out.gridStart = v.gridRange().start;
        }
        return out;
    };
    const click = (name, sel) => {
        const b = V(name).contentEl.querySelector(sel);
        if (!b) throw new Error('no ' + sel + ' in ' + name);
        b.click();
    };
    const nav = (name, which) => {
        const today = V(name).contentEl.querySelector('.view-toolbar__btn--today');
        const b = { prev: today.previousElementSibling, today, next: today.nextElementSibling }[which];
        b.click();
    };
    // The menu the plugin has open (MenuPresenter). On macOS it may be the
    // native one, outside the DOM, so its items are read from the Menu and
    // run as a click on them would.
    const menuItems = () => P.menuPresenter.currentMenu?.items ?? [];
    const menuItem = (pred) => {
        const items = menuItems();
        const item = items.find(pred);
        if (!item) throw new Error('no such menu item among ' + items.map(i => i.titleEl?.textContent).join('|'));
        P.menuPresenter.dismiss();
        item.callback(new MouseEvent('click'));
    };
    const closeMenus = () => P.menuPresenter.dismiss();
    // The plugin's overlays (filter, sort, display label editors) live on the
    // body. The panel of the newest one with class cls; its body.
    const overlay = (cls) => {
        const p = [...document.querySelectorAll('.tv-overlay__panel.' + cls)].pop();
        if (!p) throw new Error('no overlay ' + cls);
        return p.querySelector('.tv-overlay__body');
    };
    const closeOverlays = () => document.querySelectorAll('.tv-overlay__panel .tv-overlay__close').forEach(b => b.click());
    // The button under root whose text is text.
    const buttonText = (root, text) => {
        const b = [...root.querySelectorAll('button')].find(e => e.textContent.trim() === text);
        if (!b) throw new Error('no button ' + text + ' among ' + [...root.querySelectorAll('button')].map(e => e.textContent.trim()).join('|'));
        return b;
    };
    // Click the row of the open dropdown (filter-child-popover) labelled label.
    const pickChild = (label) => {
        const rows = [...document.querySelectorAll('.filter-child-popover__item')];
        const row = rows.find(r => r.querySelector('.filter-child-popover__label')?.textContent === label);
        if (!row) throw new Error('no dropdown row ' + label + ' among ' + rows.map(r => r.textContent).join('|'));
        row.click();
    };
    const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

    // A list section (a pinned list, a Kanban cell), its classes named in C:
    // { root, header, name, nameInput, count, body, collapsed }.
    const headerBtn = (C, sec, icon) => {
        const b = sec.querySelector('.' + C.header + ' button:has(svg.lucide-' + icon + ')');
        if (!b) throw new Error('no ' + icon + ' button in ' + C.root);
        return b;
    };
    const readSection = (C, sec) => {
        const body = sec.querySelector('.' + C.body);
        return {
            id: sec.dataset.listId ?? null,
            name: sec.querySelector('.' + C.name)?.textContent ?? null,
            renaming: !!sec.querySelector('.' + C.nameInput),
            count: Number((sec.querySelector('.' + C.count)?.textContent ?? '').replace(/[()]/g, '')),
            collapsed: sec.classList.contains(C.collapsed),
            sorted: headerBtn(C, sec, 'arrow-up-down').classList.contains('is-sorted'),
            filtered: headerBtn(C, sec, 'filter').classList.contains('is-filtered'),
            cards: body ? body.querySelectorAll(':scope > .task-card').length : 0,
            labels: body ? [...body.querySelectorAll(':scope > .task-card .task-card__time')].map(e => e.textContent) : [],
            more: body?.querySelector('.task-paging__show-more')?.textContent ?? null,
        };
    };

    // The filter menu open (FilterMenuComponent), driven by its controls.
    const fBody = () => overlay('filter-popover');
    const fFooter = () => fBody().querySelector('.filter-popover__footer');
    const fRows = () => [...fBody().querySelectorAll('.filter-popover__row')];
    const fSetTags = (i, tag) => {
        const input = fRows()[i].querySelector('.filter-popover__tag-value input');
        input.value = tag;
        key(input, 'Enter');
    };
    const fRowMenu = async (i, label) => {
        fRows()[i].querySelector('.filter-popover__row-header .filter-popover__more-btn').click();
        await wait(100);
        pickChild(label);
    };
    const fGroupMenu = async (i, label) => {
        fBody().querySelectorAll('.filter-popover__group-footer .filter-popover__more-btn')[i].click();
        await wait(100);
        pickChild(label);
    };
`;

/**
 * The plugin's text for `key` (`t` in src/i18n) in the vault's locale, so a
 * menu item is picked by the name the user reads, not by its place.
 */
export function tr(key: string, params: Record<string, string | number> = {}): string {
    localeData ??= (() => {
        const lang = ev<string>(`(() => JSON.stringify(window.moment.locale()))()`).split('-')[0];
        return (LOCALES[lang] ?? en) as unknown as Record<string, unknown>;
    })();
    const find = (data: unknown): string | undefined => {
        const value = key.split('.').reduce<unknown>((o, p) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[p] : undefined), data);
        return typeof value === 'string' ? value : undefined;
    };
    let text = find(localeData) ?? find(en);
    if (text === undefined) throw new Error(`no text for ${key}`);
    for (const [k, v] of Object.entries(params)) text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v));
    return text;
}
const LOCALES: Record<string, unknown> = { en, ja };
let localeData: Record<string, unknown> | undefined;

/** What `read` gives back. */
export interface ViewReading {
    type: string;
    state: Record<string, unknown> & { date?: string; weekOffset?: number };
    /** Whether a cell of today is drawn. */
    today: boolean;
    /** Timeline: its day columns. Schedule: its day. MiniCalendar: its cells. */
    dates?: string[];
    /** Calendar: its cells' labels. */
    labels?: string[];
    /** Calendar and MiniCalendar: the grid's first day. */
    gridStart?: string;
}

/** How long a change takes to be drawn (one frame, and a MiniCalendar slide). */
export const SETTLE_MS = 700;

/** Run `body` (statements, with the prelude's names) and read `name` once it has drawn. */
export function act(name: string, body: string, settleMs = SETTLE_MS): ViewReading {
    return ev<ViewReading>(`(async () => {
        ${PRELUDE}
        ${body}
        await wait(${settleMs});
        return JSON.stringify(read(${JSON.stringify(name)}));
    })()`);
}

/** Open a view of `type` with `state` in a new leaf named `name` (a former one is detached). */
export function openView(name: string, type: string, state: Record<string, unknown> = {}): ViewReading {
    return act(name, `
        if (R[${JSON.stringify(name)}]) { R[${JSON.stringify(name)}].detach(); await wait(100); }
        const leaf = app.workspace.getLeaf('tab');
        await leaf.setViewState({ type: ${JSON.stringify(type)}, state: ${JSON.stringify(state)}, active: true });
        R[${JSON.stringify(name)}] = leaf;
    `);
}

/** Read `name` without changing it. */
export function readView(name: string): ViewReading {
    return act(name, '', 0);
}

/** Click the toolbar's previous, Today/Now or next button. */
export function navigate(name: string, which: 'prev' | 'today' | 'next'): ViewReading {
    return act(name, `nav(${JSON.stringify(name)}, ${JSON.stringify(which)});`);
}

/** Pick `day` in the toolbar's Go to date picker, as the platform's picker does. */
export function goToDate(name: string, day: string): ViewReading {
    return act(name, `
        const input = V(${JSON.stringify(name)}).contentEl.querySelector('input.view-toolbar__date-picker');
        input.value = ${JSON.stringify(day)};
        input.dispatchEvent(new Event('change'));
    `);
}

/**
 * Open `obsidian://task-viewer?<params>` in a new tab, through the handler the
 * plugin registered for it, and keep the leaf it opened under `name`.
 */
export function openUri(name: string, params: Record<string, string>): ViewReading {
    return act(name, `
        if (R[${JSON.stringify(name)}]) { R[${JSON.stringify(name)}].detach(); await wait(100); }
        app.workspace.protocolHandler.handlers.get('task-viewer')({ action: 'task-viewer', position: 'tab', ...${JSON.stringify(params)} });
        await wait(300);
        R[${JSON.stringify(name)}] = app.workspace.getMostRecentLeaf();
    `);
}

/** Hand the view `name` a state, as Obsidian does with a URI opened over it (`position=override`). */
export function setViewState(name: string, state: Record<string, unknown>): ViewReading {
    return act(name, `
        const leaf = R[${JSON.stringify(name)}];
        await leaf.setViewState({ type: leaf.view.getViewType(), state: ${JSON.stringify(state)}, active: true });
    `);
}

/**
 * "Restart" the view `from`: open its saved state (`getState`) in a fresh
 * leaf named `name`, as the workspace does on launch.
 */
export function restartView(from: string, name: string): ViewReading {
    return act(name, `
        const before = V(${JSON.stringify(from)});
        const type = before.getViewType();
        const state = before.getState();
        if (R[${JSON.stringify(name)}]) { R[${JSON.stringify(name)}].detach(); await wait(100); }
        const leaf = app.workspace.getLeaf('tab');
        await leaf.setViewState({ type, state, active: true });
        R[${JSON.stringify(name)}] = leaf;
    `);
}

/**
 * Click the gear (or ⋮) of `name`'s toolbar and its Copy URI item, and
 * return what it wrote to the clipboard. The clipboard is stood in for
 * while the item runs, so the user's is left alone.
 */
export function copyUri(name: string, menuButton = 'button:has(> svg.lucide-settings)'): string {
    return ev<string>(`(async () => {
        ${PRELUDE}
        const clip = navigator.clipboard;
        const original = clip.writeText;
        let written = null;
        clip.writeText = async (text) => { written = text; };
        try {
            click(${JSON.stringify(name)}, ${JSON.stringify(menuButton)});
            await wait(100);
            menuItem(i => !!i.iconEl?.querySelector('svg.link, svg.lucide-link'));
            await wait(300);
        } finally {
            clip.writeText = original;
            closeMenus();
        }
        return JSON.stringify(written);
    })()`);
}

/** Detach every leaf the tests opened. */
export async function closeViews(): Promise<void> {
    ev(`(async () => {
        const R = window.__tvE2E ?? {};
        for (const name of Object.keys(R)) { R[name]?.detach(); delete R[name]; }
        app.plugins.plugins['obsidian-task-viewer'].menuPresenter.dismiss();
        return JSON.stringify(true);
    })()`);
    await sleep(100);
}

/** The plugin settings named, as they are now. */
export function readSettings<K extends string>(keys: readonly K[]): Record<K, unknown> {
    return ev(`(() => {
        const s = app.plugins.plugins['obsidian-task-viewer'].settings;
        return JSON.stringify(Object.fromEntries(${JSON.stringify(keys)}.map(k => [k, s[k]])));
    })()`);
}

/** Set plugin settings and save them, as the settings tab does; the views hear the save. */
export function saveSettings(patch: Record<string, unknown>, settleMs = SETTLE_MS): void {
    ev(`(async () => {
        const P = app.plugins.plugins['obsidian-task-viewer'];
        Object.assign(P.settings, ${JSON.stringify(patch)});
        await P.saveSettings();
        await new Promise(r => setTimeout(r, ${settleMs}));
        return JSON.stringify(true);
    })()`);
}

/** Plugin settings a test changed, and what puts them back (`overrideSettings`). */
export interface HeldSettings<K extends string> {
    /** The values the settings had before the test changed them. */
    readonly original: Record<K, unknown>;
    /** Save the original values back; a setting that had none is removed. */
    restore(settleMs?: number): void;
}

/**
 * Save `patch` over the plugin settings for a test, keeping what its keys and
 * those in `alsoHold` (settings the test changes later) were, so the Dev
 * vault's own settings do not decide what the test sees. Call `restore` in
 * `afterAll`; a run killed before it leaves the test's values in the vault.
 */
export function overrideSettings<K extends string>(
    patch: Partial<Record<K, unknown>>,
    alsoHold: readonly K[] = [],
    settleMs = SETTLE_MS,
): HeldSettings<K> {
    const keys = [...new Set([...Object.keys(patch) as K[], ...alsoHold])];
    // A setting that has no value is not in the reading (JSON leaves it out).
    const original = readSettings(keys);
    if (Object.keys(patch).length > 0) saveSettings(patch, settleMs);
    return {
        original,
        restore(restoreSettleMs = settleMs) {
            const absent = keys.filter(k => !(k in original));
            ev(`(async () => {
                const P = app.plugins.plugins['obsidian-task-viewer'];
                Object.assign(P.settings, ${JSON.stringify(original)});
                for (const k of ${JSON.stringify(absent)}) delete P.settings[k];
                await P.saveSettings();
                await new Promise(r => setTimeout(r, ${restoreSettleMs}));
                return JSON.stringify(true);
            })()`);
        },
    };
}

// ── Days, counted as the plugin counts them ──

function pad(n: number): string {
    return String(n).padStart(2, '0');
}

/** `d` as YYYY-MM-DD, local. */
export function ymd(d: Date): string {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function parse(day: string): Date {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(y, m - 1, d);
}

/** `day` moved by `n` days. */
export function addDays(day: string, n: number): string {
    const d = parse(day);
    d.setDate(d.getDate() + n);
    return ymd(d);
}

/** The visual day of `now`: a day starts at `startHour`. */
export function visualDay(startHour: number, now = new Date()): string {
    const d = new Date(now);
    if (d.getHours() < startHour) d.setDate(d.getDate() - 1);
    return ymd(d);
}

/** The first day of the week `day` is in (0: Sunday, 1: Monday). */
export function weekStart(day: string, weekStartDay: number): string {
    const d = parse(day);
    const back = (d.getDay() - weekStartDay + 7) % 7;
    return addDays(day, -back);
}

/** The first day of the month grid of `day`: the week of its month's 1st. */
export function monthGridStart(day: string, weekStartDay: number): string {
    return weekStart(`${day.slice(0, 8)}01`, weekStartDay);
}

/** The label Calendar writes in a cell: the full day on a 1st, else MM-DD. */
export function calendarLabel(day: string): string {
    return day.endsWith('-01') ? day : day.slice(5);
}

/** The 42 days of a grid starting at `start`. */
export function gridDays(start: string): string[] {
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}
