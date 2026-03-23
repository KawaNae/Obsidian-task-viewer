/**
 * Lightweight obsidian module stub for unit tests.
 * Only the symbols actually imported by source code are stubbed here.
 */

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

// --- CodeMirror integration stubs ---

export const editorInfoField = {} as any;

// --- moment stub (returns object with basic format/toDate) ---

export function moment(input?: any) {
    const d = input ? new Date(input) : new Date();
    return {
        format: (fmt?: string) => fmt ? d.toISOString() : d.toISOString(),
        toDate: () => d,
        isValid: () => !isNaN(d.getTime()),
    };
}

// --- Type stubs ---

export type ViewStateResult = any;
