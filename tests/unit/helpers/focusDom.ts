/**
 * A stand-in DOM, built in node, that keeps a focus and takes elements out
 * in the order Chromium (Obsidian's Electron) does, for a form that builds
 * its rows anew while one of its inputs holds the focus:
 *
 * - Taking out an element that holds the focus moves the focus to the body
 *   and sends `blur` to the element that had it, at once, before the
 *   element is taken out; a listener that runs then may change the parent.
 *   An element no longer the parent's child by the time it would be taken
 *   out throws `NotFoundError`, as `removeChild` does.
 * - `empty()` takes the children out from the last, as Obsidian's does
 *   (`Node.prototype.empty` in its `app.js`).
 * - `focus()` sends `blur` to the element that had the focus, with the
 *   element focused now as its `relatedTarget`.
 * - An event is heard by the listeners put on in the capture phase of the
 *   target's ancestors, from the top, then by the target's own; it does not
 *   bubble, as a blur does not. A listener put on with a `signal` is taken
 *   off once the signal aborts.
 */
type Listener = (e: Event) => void;
interface Entry { fn: Listener; capture: boolean }
type ListenerOptions = boolean | { capture?: boolean; signal?: AbortSignal };

export class FocusDoc {
    readonly body: FocusEl;
    activeElement: FocusEl;

    constructor() {
        this.body = new FocusEl(this);
        this.activeElement = this.body;
    }

    /** A root element, under the body, to build in. */
    root(): FocusEl {
        return this.body.createDiv();
    }
}

export class FocusEl {
    readonly children: FocusEl[] = [];
    parent: FocusEl | null = null;
    readonly classes = new Set<string>();
    readonly attrs = new Map<string, string>();
    readonly dataset: Record<string, string> = {};
    private readonly listeners = new Map<string, Entry[]>();
    text = '';
    value = '';
    disabled = false;
    placeholder = '';
    readonly style: Record<string, string> = {};

    constructor(readonly ownerDocument: FocusDoc, cls = '') {
        cls.split(/\s+/).filter(Boolean).forEach(c => this.classes.add(c));
    }

    get lastChild(): FocusEl | null {
        return this.children[this.children.length - 1] ?? null;
    }

    createDiv(o: { cls?: string; text?: string } = {}): FocusEl {
        const el = new FocusEl(this.ownerDocument, o.cls);
        el.text = o.text ?? '';
        el.parent = this;
        this.children.push(el);
        return el;
    }
    createEl(_tag: string, o: { cls?: string; text?: string; type?: string; placeholder?: string; attr?: Record<string, string> } = {}): FocusEl {
        const el = this.createDiv(o);
        if (o.placeholder !== undefined) el.placeholder = o.placeholder;
        for (const [k, v] of Object.entries(o.attr ?? {})) el.setAttribute(k, v);
        return el;
    }
    createSpan(o: { cls?: string; text?: string; attr?: Record<string, string> } = {}): FocusEl {
        return this.createEl('span', o);
    }
    /** Move `child` to the end of this element's children, from wherever it was. */
    appendChild(child: FocusEl): FocusEl {
        if (child.parent) child.parent.children.splice(child.parent.children.indexOf(child), 1);
        child.parent = this;
        this.children.push(child);
        return child;
    }
    /** Put `child` before `before` among this element's children, from wherever it was. */
    insertBefore(child: FocusEl, before: FocusEl | null): FocusEl {
        this.appendChild(child);
        if (before) {
            this.children.pop();
            this.children.splice(this.children.indexOf(before), 0, child);
        }
        return child;
    }
    getBoundingClientRect(): { left: number; right: number; top: number; bottom: number } {
        return { left: 0, right: 0, top: 0, bottom: 0 };
    }
    appendText(text: string): void {
        this.createDiv().text = text;
    }
    setText(text: string): void { this.text = text; }
    addClass(...cls: string[]): void { cls.forEach(c => this.classes.add(c)); }
    removeClass(...cls: string[]): void { cls.forEach(c => this.classes.delete(c)); }
    toggleClass(cls: string, on: boolean): void {
        if (on) this.classes.add(cls);
        else this.classes.delete(cls);
    }
    get classList(): { contains(c: string): boolean; add(c: string): void; remove(c: string): void; toggle(c: string, on: boolean): void } {
        return {
            contains: (c) => this.classes.has(c),
            add: (c) => this.addClass(c),
            remove: (c) => this.removeClass(c),
            toggle: (c, on) => this.toggleClass(c, on),
        };
    }
    /** Shown or hidden, as Obsidian's `toggle` does by the display. */
    toggle(show: boolean): void { this.style.display = show ? '' : 'none'; }
    setAttribute(k: string, v: string): void { this.attrs.set(k, v); }
    removeAttribute(k: string): void { this.attrs.delete(k); }

    contains(el: FocusEl | null): boolean {
        for (let at = el; at; at = at.parent) if (at === this) return true;
        return false;
    }

    removeChild(child: FocusEl): FocusEl {
        const doc = this.ownerDocument;
        const had = doc.activeElement;
        if (had !== doc.body && child.contains(had)) {
            doc.activeElement = doc.body;
            had.dispatchEvent(focusEvent('blur', null));
        }
        const at = this.children.indexOf(child);
        if (at === -1) throw new DOMException('The node to be removed is not a child of this node.', 'NotFoundError');
        this.children.splice(at, 1);
        child.parent = null;
        return child;
    }

    empty(): void {
        while (this.lastChild) this.removeChild(this.lastChild);
    }

    focus(): void {
        const doc = this.ownerDocument;
        const had = doc.activeElement;
        if (had === this) return;
        doc.activeElement = this;
        if (had !== doc.body) had.dispatchEvent(focusEvent('blur', this));
    }

    addEventListener(type: string, fn: Listener, opts?: ListenerOptions): void {
        const capture = typeof opts === 'boolean' ? opts : opts?.capture ?? false;
        const signal = typeof opts === 'object' ? opts.signal : undefined;
        if (signal?.aborted) return;
        const entry: Entry = { fn, capture };
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), entry]);
        signal?.addEventListener('abort', () => {
            this.listeners.set(type, (this.listeners.get(type) ?? []).filter(e => e !== entry));
        });
    }
    removeEventListener(type: string, fn: Listener): void {
        this.listeners.set(type, (this.listeners.get(type) ?? []).filter(e => e.fn !== fn));
    }
    dispatchEvent(e: Event): boolean {
        const path: FocusEl[] = [];
        for (let at = this.parent; at; at = at.parent) path.unshift(at);
        for (const el of path) for (const entry of el.listeners.get(e.type) ?? []) if (entry.capture) entry.fn(e);
        for (const entry of this.listeners.get(e.type) ?? []) entry.fn(e);
        return true;
    }

    /** The descendants with the class `cls`, in order. */
    findAll(cls: string): FocusEl[] {
        return this.children.flatMap(child => [...(child.classes.has(cls) ? [child] : []), ...child.findAll(cls)]);
    }
    /** The first descendant with the class `cls`. */
    find(cls: string): FocusEl | null {
        return this.findAll(cls)[0] ?? null;
    }

    /** Type `text` as a person does: the value, then an `input` event. */
    type(text: string): void {
        this.value = text;
        this.dispatchEvent(Object.assign(new Event('input'), { isComposing: false }));
    }
    enter(): void {
        this.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Enter', keyCode: 13, isComposing: false }));
    }
}

function focusEvent(type: string, relatedTarget: FocusEl | null): Event {
    return Object.assign(new Event(type), { relatedTarget });
}

export function asEl(el: FocusEl): HTMLElement & HTMLInputElement {
    return el as unknown as HTMLElement & HTMLInputElement;
}
