/**
 * Lightweight obsidian module stub for unit tests.
 * Only the symbols actually imported by source code are stubbed here.
 */
import { load as loadYaml } from 'js-yaml';
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

export class AbstractInputSuggest {
    app: App;
    inputEl: any;
    constructor(app: App, inputEl: any) { this.app = app; this.inputEl = inputEl; }
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
