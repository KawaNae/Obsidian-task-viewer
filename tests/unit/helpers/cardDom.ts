import { vi } from 'vitest';

/**
 * A stand-in for the DOM a card is drawn into, for unit tests in node, which
 * has no DOM: what `TaskCardRenderer.render` and the pieces it calls touch,
 * with the few selectors they ask, and `drawMarkdown`, Obsidian's draw of a
 * card's markdown as far as a card reads it.
 */

type Listener = (e: FakeEvent) => void;

export interface FakeEvent {
    target?: FakeEl;
    clientX?: number;
    clientY?: number;
    pageX?: number;
    pageY?: number;
    preventDefault(): void;
    stopPropagation(): void;
}

/** A text node. */
export class FakeText {
    readonly nodeType = 3;
    parentElement: FakeEl | null = null;

    constructor(public textContent: string) {}

    remove(): void { this.parentElement?.removeChild(this); }
}

type FakeNode = FakeEl | FakeText;

export class FakeEl {
    readonly nodeType = 1;
    tagName: string;
    classes = new Set<string>();
    dataset: Record<string, string> = {};
    attrs = new Map<string, string>();
    childNodes: FakeNode[] = [];
    parentElement: FakeEl | null = null;
    listeners = new Map<string, Listener[]>();
    checked = false;
    innerHTML = '';
    styles = new Map<string, string>();
    style = {
        display: '',
        setProperty: (name: string, value: string) => { this.styles.set(name, value); },
        removeProperty: (name: string) => { this.styles.delete(name); },
    };
    classList = {
        add: (...cs: string[]) => cs.forEach(c => this.classes.add(c)),
        remove: (...cs: string[]) => cs.forEach(c => this.classes.delete(c)),
        contains: (c: string) => this.classes.has(c),
        toggle: (c: string, on?: boolean) => { this.toggleClass(c, on ?? !this.classes.has(c)); },
    };

    constructor(tag = 'div', cls = '') {
        this.tagName = tag;
        cls.split(/\s+/).filter(Boolean).forEach(c => this.classes.add(c));
    }

    get children(): FakeEl[] { return this.childNodes.filter((n): n is FakeEl => n instanceof FakeEl); }
    get firstChild(): FakeNode | null { return this.childNodes[0] ?? null; }
    get lastChild(): FakeNode | null { return this.childNodes[this.childNodes.length - 1] ?? null; }
    get className(): string { return [...this.classes].join(' '); }
    set className(cls: string) { this.classes = new Set(cls.split(/\s+/).filter(Boolean)); }
    get isConnected(): boolean { return true; }
    get textContent(): string { return this.childNodes.map(n => n.textContent).join(''); }
    set textContent(text: string) {
        this.empty();
        if (text) this.appendChild(new FakeText(text));
    }

    createDiv(cls = ''): FakeEl { return this.appendChild(new FakeEl('div', cls)); }
    createSpan(cls = ''): FakeEl { return this.appendChild(new FakeEl('span', cls)); }
    createEl(tag: string, o: { cls?: string; text?: string; attr?: Record<string, string> } = {}): FakeEl {
        const el = this.appendChild(new FakeEl(tag, o.cls));
        if (o.text) el.appendText(o.text);
        for (const [k, v] of Object.entries(o.attr ?? {})) el.setAttribute(k, v);
        return el;
    }
    appendText(text: string): void { this.appendChild(new FakeText(text)); }
    addClass(c: string): void { this.classes.add(c); }
    removeClass(c: string): void { this.classes.delete(c); }
    hasClass(c: string): boolean { return this.classes.has(c); }
    toggleClass(c: string, on: boolean): void { if (on) this.classes.add(c); else this.classes.delete(c); }
    setText(t: string): void { this.textContent = t; }
    empty(): void {
        this.childNodes.forEach(c => { c.parentElement = null; });
        this.childNodes = [];
    }

    appendChild<T extends FakeNode>(node: T): T { return this.insertBefore(node, null); }
    insertBefore<T extends FakeNode>(node: T, ref: FakeNode | null): T {
        node.remove();
        const at = ref ? this.childNodes.indexOf(ref) : -1;
        node.parentElement = this;
        if (at < 0) this.childNodes.push(node); else this.childNodes.splice(at, 0, node);
        return node;
    }
    removeChild(node: FakeNode): void {
        const at = this.childNodes.indexOf(node);
        if (at >= 0) this.childNodes.splice(at, 1);
        node.parentElement = null;
    }
    remove(): void { this.parentElement?.removeChild(this); }

    getAttribute(name: string): string | null {
        const key = dataKey(name);
        if (key !== null) return this.dataset[key] ?? null;
        return this.attrs.get(name) ?? null;
    }
    setAttribute(name: string, value: string): void {
        const key = dataKey(name);
        if (key !== null) this.dataset[key] = value;
        else this.attrs.set(name, value);
    }
    removeAttribute(name: string): void {
        const key = dataKey(name);
        if (key !== null) delete this.dataset[key];
        else this.attrs.delete(name);
    }
    getBoundingClientRect() { return { left: 0, bottom: 0, top: 0, right: 0 }; }

    addEventListener(type: string, fn: Listener): void {
        const list = this.listeners.get(type) ?? [];
        list.push(fn);
        this.listeners.set(type, list);
    }
    removeEventListener(type: string, fn: Listener): void {
        this.listeners.set(type, (this.listeners.get(type) ?? []).filter(f => f !== fn));
    }
    /** Fire `type` at this element only (no bubbling), as a user would. */
    fire(type: string, init: Partial<FakeEvent> = {}): void {
        const e: FakeEvent = { target: this, clientX: 0, clientY: 0, pageX: 0, pageY: 0, preventDefault() {}, stopPropagation() {}, ...init };
        for (const fn of [...(this.listeners.get(type) ?? [])]) fn(e);
    }

    matches(selector: string): boolean { return matchesList(this, selector, this); }
    closest(selector: string): FakeEl | null {
        for (let el: FakeEl | null = this; el; el = el.parentElement) if (matchesList(el, selector, el)) return el;
        return null;
    }
    querySelectorAll(selector: string): FakeEl[] {
        const out: FakeEl[] = [];
        const walk = (el: FakeEl) => {
            for (const c of el.children) {
                if (matchesList(c, selector, this)) out.push(c);
                walk(c);
            }
        };
        walk(this);
        return out;
    }
    querySelector(selector: string): FakeEl | null { return this.querySelectorAll(selector)[0] ?? null; }

    /** The text nodes under this element, in document order. */
    texts(): FakeText[] {
        return this.childNodes.flatMap(n => n instanceof FakeText ? [n] : n.texts());
    }
}

/** `data-foo-bar` as its dataset key `fooBar`; null for another attribute. */
function dataKey(name: string): string | null {
    if (!name.startsWith('data-')) return null;
    return name.slice(5).replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** One compound selector: `tag.class[attr="v"]:not(.class)`, or `:scope`. */
function matchesCompound(el: FakeEl, compound: string, scope: FakeEl): boolean {
    if (compound === ':scope') return el === scope;
    let rest = compound;
    const tag = rest.match(/^[a-z]+/);
    if (tag) {
        if (el.tagName !== tag[0]) return false;
        rest = rest.slice(tag[0].length);
    }
    const parts = rest.match(/\.[\w-]+|\[[^\]]+\]|:not\([^)]*\)/g) ?? [];
    for (const part of parts) {
        if (part.startsWith('.')) {
            if (!el.classes.has(part.slice(1))) return false;
        } else if (part.startsWith('[')) {
            const m = part.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/)!;
            const value = el.getAttribute(m[1]);
            if (value === null || (m[2] !== undefined && value !== m[2])) return false;
        } else {
            if (matchesCompound(el, part.slice(5, -1), scope)) return false;
        }
    }
    return true;
}

/** A complex selector (compounds joined by ` ` or ` > `), matched right to left. */
function matchesComplex(el: FakeEl, selector: string, scope: FakeEl): boolean {
    const tokens = selector.trim().split(/\s+/);
    const go = (node: FakeEl, i: number): boolean => {
        if (!matchesCompound(node, tokens[i], scope)) return false;
        if (i === 0) return true;
        if (tokens[i - 1] === '>') {
            return !!node.parentElement && go(node.parentElement, i - 2);
        }
        for (let up = node.parentElement; up; up = up.parentElement) if (go(up, i - 1)) return true;
        return false;
    };
    return go(el, tokens.length - 1);
}

function matchesList(el: FakeEl, selectors: string, scope: FakeEl): boolean {
    return selectors.split(',').some(s => matchesComplex(el, s, scope));
}

/**
 * Markdown as the stand-in draws it: a list, a `li.task-list-item` with a
 * checkbox per `- [c] ` line, a plain `li` per other `- ` line, a line
 * indented under another in a list nested in its item. `[[target|text]]`
 * is an `a.internal-link`; the rest of a line is its text.
 */
export function drawMarkdown(markdown: string, el: FakeEl): void {
    const levels: { indent: number; ul: FakeEl }[] = [{ indent: 0, ul: el.appendChild(new FakeEl('ul')) }];
    for (const line of markdown.split('\n')) {
        const m = line.match(/^(\s*)- (.*)$/);
        if (!m) continue;
        const indent = m[1].length;
        while (levels.length > 1 && indent < levels[levels.length - 1].indent) levels.pop();
        if (indent > levels[levels.length - 1].indent) {
            const host = levels[levels.length - 1].ul.children.at(-1);
            if (host) levels.push({ indent, ul: host.appendChild(new FakeEl('ul')) });
        }
        const ul = levels[levels.length - 1].ul;
        const task = m[2].match(/^\[(.)\] (.*)$/);
        if (task) {
            const li = ul.appendChild(new FakeEl('li', 'task-list-item'));
            const box = li.appendChild(new FakeEl('input', 'task-list-item-checkbox'));
            box.setAttribute('type', 'checkbox');
            box.checked = task[1] !== ' ';
            if (task[1] !== ' ') { box.setAttribute('data-task', task[1]); li.setAttribute('data-task', task[1]); }
            drawInline(task[2], li);
            continue;
        }
        drawInline(m[2], ul.appendChild(new FakeEl('li')));
    }
}

function drawInline(text: string, el: FakeEl): void {
    let at = 0;
    for (const link of text.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)) {
        if (link.index > at) el.appendText(text.slice(at, link.index));
        el.createEl('a', { cls: 'internal-link', text: link[2] ?? link[1], attr: { 'data-href': link[1], href: link[1] } });
        at = link.index + link[0].length;
    }
    if (at < text.length) el.appendText(text.slice(at));
}

/** Obsidian's `Component`, doing nothing. */
export class FakeComponent {
    load() {}
    unload() {}
    addChild<T>(c: T): T { return c; }
    removeChild<T>(c: T): T { return c; }
    register(_fn: () => void) {}
}

/** Stand `document` (and the `NodeFilter` a tree walk names) in for the card's DOM. */
export function stubCardDocument(): void {
    vi.stubGlobal('document', {
        createElement: (tag: string) => new FakeEl(tag),
        createDocumentFragment: () => new FakeEl('fragment'),
        createTreeWalker: (root: FakeEl) => {
            const texts = root.texts();
            let at = 0;
            return { nextNode: () => texts[at++] ?? null };
        },
    });
    vi.stubGlobal('NodeFilter', { SHOW_TEXT: 4 });
}
