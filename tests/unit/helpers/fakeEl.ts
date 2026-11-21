/**
 * A stand-in for an element, for drawing code run without a DOM: only what
 * the timer widget's header touches (Obsidian's `createDiv`, `createSpan`,
 * `createEl`, `setText`, `empty`, `toggleClass`), attributes, `dataset`,
 * listeners, and selectors of one class (`.a`) or one tag (`a`).
 */

type Listener = (e: unknown) => void;

export interface FakeEvent {
    defaultPrevented: boolean;
    propagationStopped: boolean;
}

export class FakeEl {
    children: FakeEl[] = [];
    attrs = new Map<string, string>();
    classes = new Set<string>();
    text = '';
    dataset: Record<string, string> = {};
    parent: FakeEl | null = null;
    listeners = new Map<string, Listener[]>();

    constructor(cls = '', readonly tag = 'div') {
        for (const c of cls.split(/\s+/).filter(Boolean)) this.classes.add(c);
    }

    setAttribute(name: string, value: string): void { this.attrs.set(name, value); }
    getAttribute(name: string): string | null { return this.attrs.get(name) ?? null; }
    removeAttribute(name: string): void { this.attrs.delete(name); }

    appendChild(child: FakeEl): FakeEl {
        child.parent = this;
        this.children.push(child);
        return child;
    }

    createEl(tag: string, options: { cls?: string; text?: string } = {}): FakeEl {
        const child = this.appendChild(new FakeEl(options.cls, tag));
        if (options.text !== undefined) child.text = options.text;
        return child;
    }

    createDiv(cls = ''): FakeEl {
        return this.createEl('div', { cls });
    }

    createSpan(options: { cls?: string; text?: string } = {}): FakeEl {
        return this.createEl('span', options);
    }

    empty(): void {
        for (const child of this.children) child.parent = null;
        this.children = [];
        this.text = '';
    }

    /** Leave only the text, as Obsidian's `setText` does. */
    setText(text: string): void {
        this.empty();
        this.text = text;
    }

    toggleClass(cls: string, on: boolean): void {
        if (on) this.classes.add(cls);
        else this.classes.delete(cls);
    }

    remove(): void {
        if (!this.parent) return;
        this.parent.children = this.parent.children.filter(c => c !== this);
        this.parent = null;
    }

    addEventListener(type: string, listener: Listener): void {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }

    /** Fire `type` at this element: its own listeners, then its ancestors'. */
    dispatch(type: string, e: Record<string, unknown> = {}): FakeEvent {
        const event = {
            defaultPrevented: false,
            propagationStopped: false,
            target: this,
            preventDefault() { event.defaultPrevented = true; },
            stopPropagation() { event.propagationStopped = true; },
            ...e,
        };
        for (let el: FakeEl | null = this; el && !event.propagationStopped; el = el.parent) {
            for (const listener of el.listeners.get(type) ?? []) listener(event);
        }
        return event;
    }

    get textContent(): string { return this.text + this.children.map(c => c.textContent).join(''); }

    private matches(selector: string): boolean {
        return selector.startsWith('.') ? this.classes.has(selector.slice(1)) : this.tag === selector;
    }

    querySelectorAll(selector: string): FakeEl[] {
        return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
    }

    querySelector(selector: string): FakeEl | null {
        return this.querySelectorAll(selector)[0] ?? null;
    }
}

/**
 * Draw markdown as `renderCardMarkdown` would, within the call: a paragraph
 * holding the text, with an `a` for each `[[link]]` in it.
 */
export function drawMarkdown(_app: unknown, markdown: string, el: FakeEl): Promise<void> {
    const p = el.createEl('p');
    for (const part of markdown.split(/(\[\[[^\]]+\]\])/)) {
        const link = /^\[\[([^\]]+)\]\]$/.exec(part);
        if (link) p.createEl('a', { cls: 'internal-link', text: link[1] });
        else if (part) p.createSpan({ text: part });
    }
    return Promise.resolve();
}
