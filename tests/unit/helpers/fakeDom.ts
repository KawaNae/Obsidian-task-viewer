/**
 * An element of a stand-in DOM for the form's pieces, which a unit test
 * builds in node: what `IssueBoard`, `bindField` and the candidates'
 * drawing (`candidateView`) touch, and no more.
 */
type Listener = (e: Event) => void;

export class FakeEl {
    readonly children: FakeEl[] = [];
    readonly attrs = new Map<string, string>();
    private readonly listeners = new Map<string, Listener[]>();
    readonly classList: { contains(c: string): boolean; toggle(c: string, on?: boolean): void };
    readonly classes = new Set<string>();
    text = '';
    value = '';

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
    blur(): void { this.dispatchEvent(new Event('blur')); }
    enter(init: Partial<KeyboardEventInit> = {}): void {
        this.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Enter', keyCode: 13, isComposing: false, preventDefault() { /* taken */ }, ...init }));
    }
}

export function asEl(el: FakeEl): HTMLElement & HTMLInputElement {
    return el as unknown as HTMLElement & HTMLInputElement;
}
