import { describe, it, expect } from 'vitest';
import type { MarkdownPostProcessorContext } from 'obsidian';
import { createGenBlockPreview } from '../../../src/editor/GenBlockPreview';

/** Just enough of Obsidian's element helpers for the preview to draw into. */
class FakeEl {
    children: FakeEl[] = [];
    style = { setProperty() {} };
    constructor(public cls = '', public text = '') {}
    createDiv(o: { cls?: string; text?: string } = {}): FakeEl { return this.add(o); }
    createSpan(o: { cls?: string; text?: string } = {}): FakeEl { return this.add(o); }
    private add(o: { cls?: string; text?: string }): FakeEl {
        const el = new FakeEl(o.cls ?? '', o.text ?? '');
        this.children.push(el);
        return el;
    }
    find(cls: string): FakeEl | undefined {
        for (const c of this.children) {
            if (c.cls === cls) return c;
            const hit = c.find(cls);
            if (hit) return hit;
        }
        return undefined;
    }
}

function nameShown(text: string, lineStart: number): string | undefined {
    const el = new FakeEl();
    const ctx = {
        getSectionInfo: () => ({ text, lineStart, lineEnd: lineStart + 2 }),
    } as unknown as MarkdownPostProcessorContext;
    createGenBlockPreview()('- [ ] a', el as unknown as HTMLElement, ctx);
    return el.find('tv-gen-preview__name')?.text;
}

// The block is found by the line Obsidian says it opens on, so the file's
// text has to be cut into lines the way Obsidian cuts it (splitLines).
describe('GenBlockPreview — the lines it finds the block among', () => {
    it('counts a lone CR as the end of a line', () => {
        expect(nameShown('intro\rmore\n```tv-gen 週報\n- [ ] a\n```', 2)).toBe('週報');
    });

    it('reads a CRLF file', () => {
        expect(nameShown('intro\r\n```tv-gen 週報\r\n- [ ] a\r\n```', 1)).toBe('週報');
    });
});
