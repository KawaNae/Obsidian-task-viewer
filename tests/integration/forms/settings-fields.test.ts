/**
 * The settings' fields and the load (段10g), in the running Dev vault: a
 * settings field reads what is typed and commits once (a blur, the form's
 * Enter), saving only a value that reads and saying under its description
 * why one does not; a scope key typed again tells nothing and reads the
 * notes again once, on its commit; the load fills a key missing from a
 * group with its default. The filter's N and the interval template's
 * numbers say what does not read under their row, and keep it as typed.
 *
 * The settings are opened as a person opens them; fields are typed in as
 * a person types (the text, then its `input` event). Every test leaves
 * `data.json` as it found it, which is checked on the disk.
 *
 * Prerequisites:
 *   - Obsidian is running with the Dev vault (path in dev-paths.mjs) open,
 *     with a build of 段10g
 *
 * Run:  npx vitest run --config vitest.config.e2e.ts tests/integration/forms/settings-fields.test.ts
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { isObsidianRunning, obsidianEval } from '../helpers/cli-helper';
import { readTestFile } from '../helpers/test-file-manager';
import { closeViews, openView, overrideSettings, tr } from '../helpers/view-helper';

const DATA_JSON = '.obsidian/plugins/obsidian-task-viewer/data.json';

const PRELUDE = `
const sleep = ms => new Promise(r => setTimeout(r, ms));
const plugin = app.plugins.plugins['obsidian-task-viewer'];
const until = async (test, ms = 3000) => { const end = Date.now() + ms; while (Date.now() < end) { if (test()) return true; await sleep(50); } return false; };
const key = (el, init) => el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
const enter = el => key(el, { key: 'Enter', code: 'Enter', keyCode: 13 });
/** Type text in a field as a person does: the text, then its input event. */
const type = (input, text) => { input.focus(); input.value = text; input.dispatchEvent(new InputEvent('input', { bubbles: true })); };
const blur = input => { input.blur(); input.dispatchEvent(new FocusEvent('blur')); };
/** The plugin's settings tab as shown (the settings may stand in a window of their own). */
const settingsTab = () => app.setting.activeTab?.id === 'obsidian-task-viewer' ? app.setting.activeTab.containerEl : null;
/** Open the plugin's settings on the tab \`tabId\`. */
const openSettings = async (tabId) => {
    app.setting.open();
    app.setting.openTabById('obsidian-task-viewer');
    await until(() => settingsTab()?.isConnected && settingsTab().querySelector('.tv-settings__nav-btn'));
    settingsTab().querySelector('.tv-settings__nav-btn[data-tab-id="' + tabId + '"]').click();
    await sleep(100);
};
const closeSettings = async () => { app.setting.close(); await sleep(300); };
/** The setting named \`name\` in the tab shown: its text field, and what it says under its description. */
const settingOf = name => {
    const panel = [...settingsTab().querySelectorAll('.tv-settings__panel')].find(p => p.style.display !== 'none');
    const item = [...panel.querySelectorAll('.setting-item')].find(el => el.querySelector('.setting-item-name')?.textContent === name);
    if (!item) throw new Error('no setting ' + name);
    return {
        input: item.querySelector('.setting-item-control input[type="text"], .setting-item-control input:not([type])'),
        says: () => [...item.querySelectorAll('.tv-settings__says > *')].map(el => el.textContent).join(' ') || null,
        marked: () => item.querySelector('.setting-item-control input').getAttribute('aria-invalid') === 'true',
    };
};
/** Count the saves and the notices from now on. */
const watch = () => {
    const seen = { saves: 0, notices: 0 };
    const save = plugin.saveSettings;
    plugin.saveSettings = async function (...args) { seen.saves++; return save.apply(this, args); };
    const notices = new MutationObserver(records => {
        for (const r of records) for (const n of r.addedNodes) if (n.classList?.contains('notice')) seen.notices++;
    });
    notices.observe(document.body, { childList: true, subtree: true });
    seen.stop = () => { plugin.saveSettings = save; notices.disconnect(); };
    return seen;
};
`;

/** Run `body` (statements, ending in a `return`) in Obsidian after the prelude. */
function run<T>(body: string): T {
    const result = obsidianEval(`(async () => { ${PRELUDE}\n${body}\n})()`);
    if (result && typeof result === 'object' && 'error' in (result as object)) {
        throw new Error(`eval failed: ${(result as { error: string }).error}`);
    }
    return result as T;
}

/** The plugin's settings on the disk, as an object. */
function storedSettings(): Record<string, unknown> {
    return JSON.parse(readTestFile(DATA_JSON)) as Record<string, unknown>;
}

beforeAll(() => {
    if (!isObsidianRunning()) {
        throw new Error('Obsidian is not running or CLI is unreachable. Start Obsidian with the Dev vault before running integration tests.');
    }
    // Focus moves need the window to have the focus.
    if (process.platform === 'darwin') execFileSync('open', ['-a', 'Obsidian']);
});

afterEach(() => {
    run(`
        if (app.setting.activeTab) app.setting.close();
        document.querySelectorAll('.tv-overlay:not(.is-closing) .tv-overlay__close').forEach(b => b.click());
        await sleep(250);
        return 'ok';
    `);
});

describe('the settings\' fields', () => {
    it('does not save an emptied start of the day: it says why under the description, and the setting keeps its hour', () => {
        const before = storedSettings();
        const result = run<Record<string, unknown>>(`
            const hour = plugin.settings.startHour;
            await openSettings('basic');
            const seen = watch();
            const field = settingOf(${JSON.stringify(tr('settings.views.startHour'))});
            type(field.input, '');
            blur(field.input);
            await sleep(200);
            const out = { kept: plugin.settings.startHour === hour, text: field.input.value, says: field.says(), marked: field.marked(), saves: seen.saves };
            type(field.input, '24');
            enter(field.input);
            await sleep(200);
            out.outOfRange = { kept: plugin.settings.startHour === hour, says: field.says(), saves: seen.saves };
            // Typed back to the hour it holds: nothing to say, nothing to save.
            type(field.input, String(hour));
            blur(field.input);
            await sleep(200);
            out.back = { says: field.says(), marked: field.marked(), saves: seen.saves };
            seen.stop();
            await closeSettings();
            return JSON.stringify(out);
        `);
        expect(result).toEqual({
            kept: true, text: '', says: tr('issue.empty'), marked: true, saves: 0,
            outOfRange: { kept: true, says: tr('issue.rangeBetween', { min: 0, max: 23 }), saves: 0 },
            back: { says: null, marked: false, saves: 0 },
        });
        expect(storedSettings()).toEqual(before);
    });

    it('a scope key emptied and typed again tells nothing and saves nothing while typed, and saves once on its commit', () => {
        const before = storedSettings();
        const result = run<Record<string, unknown>>(`
            const start = plugin.settings.scopeKeys.start;
            await openSettings('frontmatter');
            const seen = watch();
            const field = settingOf(${JSON.stringify(tr('settings.frontmatter.startKey'))});
            type(field.input, '');
            const emptied = { says: field.says(), saves: seen.saves, notices: seen.notices, key: plugin.settings.scopeKeys.start };
            for (const text of ['t', 'tv', 'tv-', 'tv-e2e-begin']) type(field.input, text);
            const typed = { says: field.says(), saves: seen.saves, notices: seen.notices, key: plugin.settings.scopeKeys.start };
            blur(field.input);
            await sleep(500);
            const committed = { saves: seen.saves, notices: seen.notices, key: plugin.settings.scopeKeys.start };
            // Another scope key's name is refused, said under the description.
            type(field.input, plugin.settings.scopeKeys.end);
            blur(field.input);
            await sleep(200);
            const clash = { says: field.says(), saves: seen.saves, key: plugin.settings.scopeKeys.start };
            // Back to the key it had, saved once more.
            type(field.input, start);
            blur(field.input);
            await sleep(500);
            const back = { saves: seen.saves, notices: seen.notices, key: plugin.settings.scopeKeys.start === start };
            seen.stop();
            await closeSettings();
            return JSON.stringify({ emptied, typed, committed, clash, back });
        `);
        expect(result).toEqual({
            emptied: { says: tr('issue.empty'), saves: 0, notices: 0, key: 'tv-start' },
            typed: { says: null, saves: 0, notices: 0, key: 'tv-start' },
            committed: { saves: 1, notices: 0, key: 'tv-e2e-begin' },
            clash: { says: tr('issue.duplicate'), saves: 1, key: 'tv-e2e-begin' },
            back: { saves: 2, notices: 0, key: true },
        });
        expect(storedSettings()).toEqual(before);
    });

    it('commits what is typed as the settings close', () => {
        const before = storedSettings();
        const result = run<Record<string, unknown>>(`
            const days = plugin.settings.pastDaysToShow;
            await openSettings('viewDetails');
            const field = settingOf(${JSON.stringify(tr('settings.views.pastDaysToShow'))});
            type(field.input, String(days + 2));
            await closeSettings();
            const closed = plugin.settings.pastDaysToShow;
            plugin.settings.pastDaysToShow = days;
            await plugin.saveSettings();
            return JSON.stringify({ moved: closed - days });
        `);
        expect(result).toEqual({ moved: 2 });
        expect(storedSettings()).toEqual(before);
    });
});

describe('the settings\' load', () => {
    afterEach(async () => { await closeViews(); });

    it('fills a view\'s position missing from data.json with its default, and the view opens there', () => {
        const before = storedSettings();
        const result = run<Record<string, unknown>>(`
            const load = plugin.loadData;
            try {
                // data.json as saved before the kanban had a position.
                plugin.loadData = async () => {
                    const data = await load.call(plugin);
                    delete data.defaultViewPositions.kanban;
                    return data;
                };
                await plugin.loadSettings();
                const position = plugin.settings.defaultViewPositions.kanban;
                const others = plugin.settings.defaultViewPositions.timeline;
                app.workspace.getLeavesOfType('kanban-view').forEach(l => l.detach());
                await plugin.activateView('kanban-view');
                await sleep(300);
                const leaf = app.workspace.getLeavesOfType('kanban-view')[0];
                const inMain = leaf?.getRoot() === app.workspace.rootSplit;
                leaf?.detach();
                return JSON.stringify({ position, others, inMain });
            } finally {
                plugin.loadData = load;
                await plugin.loadSettings();
            }
        `);
        expect(result).toEqual({ position: 'tab', others: (before.defaultViewPositions as Record<string, unknown>).timeline, inMain: true });
        expect(storedSettings()).toEqual(before);
    });
});

describe('the filter\'s N of the next N days', () => {
    afterEach(async () => { await closeViews(); });

    it('says what does not read under the row, keeps it as typed, and commits one that does', () => {
        const result = run<Record<string, unknown>>(`
            const side = app.workspace.getLeaf('split');
            await side.setViewState({ type: 'timeline-view', active: false, state: { filterState: { logic: 'and', filters: [{ property: 'startDate', operator: 'onOrBefore', value: { preset: 'nextNDays', n: 7 } }] } } });
            await sleep(500);
            side.view.contentEl.querySelector('.view-toolbar button:has(svg.lucide-filter)').click();
            const popover = () => document.querySelector('.tv-overlay:not(.is-closing) .tv-overlay__panel.filter-popover');
            await until(() => popover());
            const input = () => popover().querySelector('.filter-popover__number-input');
            const says = () => [...popover().querySelectorAll('.filter-popover__says > *')].map(el => el.textContent).join(' ') || null;
            const n = () => side.view.getState().filterState.filters[0].value.n;
            type(input(), '0');
            enter(input());
            await sleep(200);
            const zero = { text: input().value, says: says(), marked: input().getAttribute('aria-invalid'), n: n() };
            type(input(), '１４');
            enter(input());
            await sleep(300);
            const fourteen = { text: input()?.value, says: says(), n: n() };
            document.querySelectorAll('.tv-overlay:not(.is-closing) .tv-overlay__close').forEach(b => b.click());
            await sleep(200);
            side.detach();
            return JSON.stringify({ zero, fourteen });
        `);
        expect(result).toEqual({
            zero: { text: '0', says: tr('issue.rangeAtLeast', { min: 1 }), marked: 'true', n: 7 },
            fourteen: { text: '14', says: null, n: 14 },
        });
    });
});

describe('the interval template\'s numbers', () => {
    afterEach(async () => { await closeViews(); });

    it('says a number out of range under its row, keeps it as typed, and does not save', () => {
        const before = storedSettings();
        // The list of templates, and its button to make one, show once a folder is set.
        const held = overrideSettings({ intervalTemplateFolder: 'test-int-10g-timers' });
        let result: Record<string, unknown>;
        try {
            openView('timer', 'timer-view', { timerViewMode: 'interval' });
            result = run<Record<string, unknown>>(`
            const leaf = app.workspace.getLeavesOfType('timer-view')[0];
            await until(() => leaf.view.contentEl.querySelector('.timer-view__add-template-btn'));
            leaf.view.contentEl.querySelector('.timer-view__add-template-btn').click();
            const creator = () => document.querySelector('.tv-overlay:not(.is-closing) .template-creator');
            await until(() => creator());
            const files = app.vault.getMarkdownFiles().length;
            type(creator().querySelector('.template-creator__field input'), 'e2e-10g');
            const minutes = creator().querySelectorAll('.template-creator__segment .template-creator__dur-input')[1];
            type(minutes, '60');
            blur(minutes);
            await sleep(100);
            const says = () => [...creator().querySelectorAll('.template-creator__segments .tv-form__says > *')].map(el => el.textContent).join(' ') || null;
            const typed = { text: minutes.value, says: says(), marked: minutes.getAttribute('aria-invalid') };
            creator().querySelector('.template-creator__save-btn').click();
            await sleep(500);
            const saved = { open: !!creator(), text: minutes.value, says: says(), files: app.vault.getMarkdownFiles().length - files };
            creator().querySelector('.template-creator__close-btn').click();
            await sleep(200);
            return JSON.stringify({ typed, saved });
        `);
        } finally {
            held.restore();
        }
        expect(storedSettings()).toEqual(before);
        expect(result).toEqual({
            typed: { text: '60', says: tr('issue.rangeBetween', { min: 0, max: 59 }), marked: 'true' },
            saved: { open: true, text: '60', says: tr('issue.rangeBetween', { min: 0, max: 59 }), files: 0 },
        });
    });
});
