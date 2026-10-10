/**
 * Lightweight obsidian module stub for unit tests.
 * Only the symbols actually imported by source code are stubbed here.
 */
import { dump as dumpYaml, load as loadYaml } from 'js-yaml';
import { StateField } from '@codemirror/state';

// --- Core classes ---

export class App {
    vault = new Vault();
    workspace = {} as any;
    metadataCache = {} as any;
}

export class TFile {
    path = '';
    basename = '';
    extension = 'md';
    stat = { mtime: 0, ctime: 0, size: 0 };
    vault = {} as any;
    parent = null;
    name = '';
}

export class TFolder {
    path = '';
    name = '';
    children: any[] = [];
    parent = null;
    vault = {} as any;
    isRoot() { return false; }
}

class Vault {
    getAbstractFileByPath(_path: string) { return null; }
    getMarkdownFiles() { return []; }
    read(_file: TFile) { return Promise.resolve(''); }
    process(_file: TFile, _fn: (data: string) => string) { return Promise.resolve(''); }
}

// --- UI classes (no-op stubs) ---

export class Notice {
    /** Messages raised during a test run — handy when asserting user feedback. */
    static messages: string[] = [];
    constructor(message: string | DocumentFragment, _duration?: number) {
        if (typeof message === 'string') Notice.messages.push(message);
    }
    setMessage(_message: string | DocumentFragment) { return this; }
    hide() {}
}

export class Plugin {
    app: App = new App();
    manifest = {} as any;
    loadData() { return Promise.resolve({}); }
    saveData(_data: any) { return Promise.resolve(); }
}

export class Scope {
    /** What was registered, in order, as Obsidian's Scope keeps it. */
    keys: { modifiers: unknown; key: string | null; func: (evt: unknown, ctx: unknown) => unknown }[] = [];
    constructor(public parent?: Scope) {}
    register(modifiers: unknown, key: string | null, func: (evt: unknown, ctx: unknown) => unknown): unknown {
        const handler = { modifiers, key, func };
        this.keys.push(handler);
        return handler;
    }
    unregister(): void {}
}

export class Modal {
    app: App;
    constructor(app: App) { this.app = app; }
    open() {}
    close() {}
    onOpen() {}
    onClose() {}
}

export class ItemView {
    app: App = new App();
    containerEl = { empty() {}, createDiv() { return {}; } } as any;
    getViewType() { return ''; }
    getDisplayText() { return ''; }
}

export class MarkdownView extends ItemView {}

export class Component {
    load() {}
    unload() {}
}

/** Only what the plugin's suggests read of it: the app and the open context. */
export class EditorSuggest<T> {
    context: { editor: any; start: { line: number; ch: number } } | null = null;
    constructor(public app: any) { }
    close(): void { }
    /** Unused by the stub; present so the type parameter is read. */
    protected value?: T;
}

/**
 * Obsidian's stack of what takes the back (`onHistoryBack`), and
 * `PopoverSuggest`'s `open` and `close` on it, written as Obsidian 1.13.7's
 * are: the scope pushed, the DOM attached, then the suggestion pushed; and
 * the reverse on close.
 */
export const historyStack: { onHistoryBack(): void }[] = [];

export class PopoverSuggest {
    app: any;
    scope: unknown;
    isOpen = false;
    win: unknown = null;
    autoDestroy: (() => void) | null = null;
    suggestions: any;
    constructor(app: any) { this.app = app; }
    attachDom(): void {}
    detachDom(): void {}
    onHistoryBack(): void { this.close(); }
    open(): void {
        const app = this.app;
        if (this.isOpen) return;
        this.isOpen = true;
        this.win = (globalThis as { activeWindow?: unknown }).activeWindow ?? null;
        app.keymap.pushScope(this.scope);
        this.attachDom();
        historyStack.push(this);
    }
    close(): void {
        const app = this.app;
        if (this.autoDestroy) { this.autoDestroy(); this.autoDestroy = null; }
        app.keymap.popScope(this.scope);
        if (!this.isOpen) return;
        this.isOpen = false;
        this.suggestions.setSuggestions([]);
        this.detachDom();
        historyStack.splice(historyStack.indexOf(this), 1);
        this.win = null;
    }
}

export class AbstractInputSuggest extends PopoverSuggest {
    inputEl: any;
    limit = 100;
    constructor(app: App, inputEl: any) {
        super(app);
        this.inputEl = inputEl;
        // Obsidian's: a scope whose parent is the app's, holding the list's keys.
        this.scope = new Scope((app as { scope?: Scope } | undefined)?.scope);
        (this.scope as Scope).register([], 'Escape', () => false);
        (this.scope as Scope).register([], 'Enter', () => false);
    }
    setValue(value: string): void { this.inputEl.value = value; }
    getValue(): string { return this.inputEl.value; }
}

export class Setting {
    constructor(_containerEl: any) {}
    setName(_name: string) { return this; }
    setDesc(_desc: string) { return this; }
    addText(_cb: any) { return this; }
    addToggle(_cb: any) { return this; }
    addDropdown(_cb: any) { return this; }
    addButton(_cb: any) { return this; }
    addSlider(_cb: any) { return this; }
}

export class Menu {
    addItem(_cb: any) { return this; }
    addSeparator() { return this; }
    showAtMouseEvent(_evt: any) {}
    close() {}
}

export class Workspace {
    on(_event: string, _cb: any) { return { id: '' }; }
    off(_event: string, _ref: any) {}
    getLeavesOfType(_type: string) { return []; }
}

export class WorkspaceLeaf {
    view: any = {};
}

export class Editor {
    getLine(_n: number) { return ''; }
    setLine(_n: number, _text: string) {}
    lineCount() { return 0; }
    replaceRange(_text: string, _from: any, _to?: any) {}
}

export class FileSystemAdapter {
    getBasePath() { return ''; }
}

// --- Utility functions ---

export function setIcon(_el: HTMLElement, _icon: string) {}
export function normalizePath(path: string) { return path; }

/** A wikilink's text cut at its first `#`, as Obsidian cuts it: the subpath keeps the `#`. */
export function parseLinktext(linktext: string): { path: string; subpath: string } {
    const hash = linktext.indexOf('#');
    return hash < 0 ? { path: linktext, subpath: '' } : { path: linktext.slice(0, hash), subpath: linktext.slice(hash) };
}

/** The aliases a frontmatter names, as Obsidian reads them: a list, or one string; null for none. */
export function parseFrontMatterAliases(frontmatter: any | null): string[] | null {
    const raw = frontmatter?.aliases ?? frontmatter?.alias;
    if (raw === undefined || raw === null) return null;
    const list = (Array.isArray(raw) ? raw : String(raw).split(',')).map((one: unknown) => String(one).trim()).filter(Boolean);
    return list.length > 0 ? list : null;
}

/**
 * A stand-in for Obsidian's fuzzy search: the query's characters, spaces
 * aside, in order in the text, case aside, each taken at its first place.
 * The ranges are the runs of matched characters; the fewer the runs, and
 * the earlier the first, the higher the score, which is below 0 as
 * Obsidian's is. Not Obsidian's numbers: a unit test asserts the order its
 * rules make, not the score.
 */
export function prepareFuzzySearch(query: string): (text: string) => { score: number; matches: [number, number][] } | null {
    const wanted = query.toLowerCase().replace(/\s+/g, '');
    return (text: string) => {
        const lower = text.toLowerCase();
        const matches: [number, number][] = [];
        let at = 0;
        for (const ch of wanted) {
            const found = lower.indexOf(ch, at);
            if (found < 0) return null;
            const last = matches[matches.length - 1];
            if (last && last[1] === found) last[1] = found + 1;
            else matches.push([found, found + 1]);
            at = found + 1;
        }
        if (matches.length === 0) return null;
        return { score: -(matches.length - 1) - matches[0][0] / 1000 - text.length / 10000 - 0.001, matches };
    };
}

/** A stand-in for Obsidian's simple search: each space-separated word a substring, case aside. */
export function prepareSimpleSearch(query: string): (text: string) => { score: number; matches: [number, number][] } | null {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return (text: string) => {
        const lower = text.toLowerCase();
        const matches: [number, number][] = [];
        for (const word of words) {
            const found = lower.indexOf(word);
            if (found < 0) return null;
            matches.push([found, found + word.length]);
        }
        return { score: -matches.length, matches: matches.sort((a, b) => a[0] - b[0]) };
    };
}

/**
 * Obsidian's `renderMatches`, as Obsidian 1.13.7 writes it: the text, each
 * range moved by `offset` and drawn as a `suggestion-highlight` span.
 */
export function renderMatches(el: any, text: string, matches: [number, number][] | null, offset = 0): void {
    if (!matches || matches.length === 0) {
        el.appendText(text);
        return;
    }
    let at = 0;
    for (const [from, to] of matches) {
        let start = from + offset;
        const end = to + offset;
        if (end <= 0) continue;
        if (start >= text.length) break;
        if (start < 0) start = 0;
        if (start !== at) el.appendText(text.substring(at, start));
        el.createSpan({ cls: 'suggestion-highlight', text: text.substring(start, end) });
        at = end;
    }
    if (at < text.length) el.appendText(text.substring(at));
}

/**
 * A bare `2026-09-21` in frontmatter comes back as a `Date`, not a string —
 * `DateTimeFieldParser.normalizeYamlDate` exists specifically to turn that
 * back into text, and js-yaml's default schema does the same implicit-typing
 * for a plain date-like scalar. This stub used to be missing entirely, so
 * every call from `FileParsePipeline`'s raw-block fallback
 * (`FileParsePipeline.ts:54`) threw `TypeError: parseYaml is not a
 * function`, caught and swallowed by the `catch {}` right after it. Every
 * frontmatter read through that fallback silently produced nothing.
 */
export function parseYaml(yaml: string): any {
    return loadYaml(yaml);
}

/** Obsidian's writes the block style too; js-yaml's dump is the nearest. */
export function stringifyYaml(obj: any): string {
    return dumpYaml(obj);
}

// --- CodeMirror integration stubs ---

/**
 * The field Obsidian keeps an editor's file in. A real field here, so that a
 * test builds an `EditorState` for a note with `editorInfoField.init(() => ({ file }))`.
 */
export const editorInfoField = StateField.define<{ file: { path: string } | null }>({
    create: () => ({ file: null }),
    update: value => value,
});

// --- moment stub (returns object with basic format/toDate) ---

/**
 * What `moment.locale()` answers, and therefore which locale `initI18n()`
 * picks. Settable so a test can read the other language's file through the
 * real path rather than reaching into the JSON itself.
 */
let localeName = 'en';

export function setMockLocale(name: string): void {
    localeName = name;
}

export const moment = Object.assign(
    function moment(input?: any) {
        const d = input ? new Date(input) : new Date();
        return {
            format: (fmt?: string) => fmt ? d.toISOString() : d.toISOString(),
            toDate: () => d,
            isValid: () => !isNaN(d.getTime()),
        };
    },
    { locale: () => localeName },
);

// --- Type stubs ---

export type ViewStateResult = any;
