/**
 * An element of a stand-in DOM for the form's pieces, which a unit test
 * builds in node: what `IssueBoard`, `bindField`, the candidates'
 * drawing (`candidateView`), the send dialog's note field and the
 * start-offset dialog's body touch, and no more.
 */
type Listener = (e: Event) => void;

export class FakeEl {
    readonly children: FakeEl[] = [];
    readonly attrs = new Map<string, string>();
    readonly dataset: Record<string, string> = {};
    private readonly listeners = new Map<string, Listener[]>();
    readonly classList: { contains(c: string): boolean; toggle(c: string, on?: boolean): void };
    readonly classes = new Set<string>();
    text = '';
    value = '';
    /** The inline style, as far as a form's pieces set it (`display`). */
    readonly style: Record<string, string> = {};
    disabled = false;
    tabIndex = 0;

    constructor(cls = '') {
        cls.split(/\s+/).filter(Boolean).forEach(c => this.classes.add(c));
        this.classList = {
            contains: (c) => this.classes.has(c),
            toggle: (c, on) => {
                if (on ?? !this.classes.has(c)) this.classes.add(c);
                else this.classes.delete(c);
            },
        };
    }

    createDiv(o: { cls?: string; text?: string } = {}): FakeEl {
        const el = new FakeEl(o.cls);
        el.text = o.text ?? '';
        this.children.push(el);
        return el;
    }
    createEl(_tag: string, o: { cls?: string; text?: string; type?: string; placeholder?: string; attr?: Record<string, string> } = {}): FakeEl {
        const el = this.createDiv(o);
        if (o.placeholder !== undefined) el.setAttribute('placeholder', o.placeholder);
        for (const [k, v] of Object.entries(o.attr ?? {})) el.setAttribute(k, v);
        return el;
    }
    createSpan(o: { cls?: string; text?: string; attr?: Record<string, string> } = {}): FakeEl {
        const el = this.createDiv(o);
        for (const [k, v] of Object.entries(o.attr ?? {})) el.setAttribute(k, v);
        return el;
    }
    /** A text node, as a child that has no class. */
    appendText(text: string): void {
        const node = new FakeEl();
        node.text = text;
        this.children.push(node);
    }
    addClass(...cls: string[]): void { cls.forEach(c => this.classes.add(c)); }
    toggleClass(c: string, on: boolean): void { this.classList.toggle(c, on); }
    setText(text: string): void { this.text = text; }
    /** Shown or not, as Obsidian's `toggle` does it: by its `hidden`. */
    hidden = false;
    toggle(shown: boolean): void { this.hidden = !shown; }
    /** Its text and its children's, in order. */
    get textContent(): string {
        return this.text + this.children.map(c => c.textContent).join('');
    }
    /** The first descendant with the class `cls`. */
    find(cls: string): FakeEl | null {
        for (const child of this.children) {
            if (child.classes.has(cls)) return child;
            const deeper = child.find(cls);
            if (deeper) return deeper;
        }
        return null;
    }
    /** Every descendant with the class `cls`, in document order. */
    findAll(cls: string): FakeEl[] {
        return this.children.flatMap(c => [...(c.classes.has(cls) ? [c] : []), ...c.findAll(cls)]);
    }
    empty(): void { this.children.length = 0; }
    setAttribute(k: string, v: string): void { this.attrs.set(k, v); }
    removeAttribute(k: string): void { this.attrs.delete(k); }
    addEventListener(type: string, fn: Listener): void {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
    }
    dispatchEvent(e: Event): boolean {
        for (const fn of this.listeners.get(e.type) ?? []) fn(e);
        return true;
    }

    /** The lines said in this element, as `tone: text`. */
    lines(): string[] {
        return this.children.map(c => `${[...c.classes][0]?.replace('tv-form__', '')}: ${c.text}`);
    }

    /** Type `text` as a person does: the value, then an `input` event. */
    type(text: string): void {
        this.value = text;
        this.dispatchEvent(Object.assign(new Event('input'), { isComposing: false }));
    }
    /** Focus it: the document's active element, as `focused` reads it. */
    focus(): void {
        focusedEl = this;
        this.dispatchEvent(new Event('focus'));
    }
    /** The document, as far as its active element: the element focused last (`focused`). */
    get ownerDocument(): { readonly activeElement: FakeEl | null } {
        return { get activeElement() { return focusedEl; } };
    }
    blur(): void {
        if (focusedEl === this) focusedEl = null;
        this.dispatchEvent(new Event('blur'));
    }
    /** Press it as a pointer does: `mousedown`, whose default a handler may prevent, then `click`; a disabled one takes neither, as a browser's does not. */
    press(): { defaultPrevented: boolean } {
        if (this.disabled) return { defaultPrevented: false };
        const down = new Event('mousedown', { cancelable: true });
        this.dispatchEvent(down);
        this.dispatchEvent(new Event('click'));
        return { defaultPrevented: down.defaultPrevented };
    }
    enter(init: Partial<KeyboardEventInit> = {}): void {
        this.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Enter', keyCode: 13, isComposing: false, preventDefault() { /* taken */ }, ...init }));
    }
}

let focusedEl: FakeEl | null = null;

/** The element focused last (`focus`), as a document's active element. */
export function focused(): FakeEl | null {
    return focusedEl;
}

export function asEl(el: FakeEl): HTMLElement & HTMLInputElement {
    return el as unknown as HTMLElement & HTMLInputElement;
}
