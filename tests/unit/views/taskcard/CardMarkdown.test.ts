import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A card's markdown is drawn by one call that does not wait: the body is in
 * the element when Obsidian's renderer returns. When it is not, that is
 * logged once a session; a render that fails is logged and settles.
 */

const render = vi.fn();
vi.mock('obsidian', async () => {
    const actual = await vi.importActual<Record<string, unknown>>('obsidian');
    return { ...actual, MarkdownRenderer: { render: (...args: unknown[]) => render(...args) } };
});

/** An element with only what the call reads. */
function el(): HTMLElement {
    const children: unknown[] = [];
    return { children } as unknown as HTMLElement;
}

async function load() {
    vi.resetModules();
    const log = await import('../../../../src/log/log');
    log.clearLog();
    const { renderCardMarkdown } = await import('../../../../src/views/taskcard/CardMarkdown');
    const warnings = () => log.getLogEntries().filter(e => e.level === 'warn');
    const errors = () => log.getLogEntries().filter(e => e.level === 'error');
    return { renderCardMarkdown, warnings, errors };
}

beforeEach(() => {
    render.mockReset();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('renderCardMarkdown', () => {
    it('logs nothing when the body is in the element on return', async () => {
        const m = await load();
        render.mockImplementation((_app, _md, target: { children: unknown[] }) => {
            target.children.push({});
            return new Promise<void>(() => {});
        });

        m.renderCardMarkdown({} as never, '- [ ] a', el(), 'a.md', {} as never);

        expect(m.warnings()).toEqual([]);
    });

    it('logs an element left empty once a session', async () => {
        const m = await load();
        render.mockResolvedValue(undefined);

        m.renderCardMarkdown({} as never, '- [ ] a', el(), 'a.md', {} as never);
        m.renderCardMarkdown({} as never, '- [ ] b', el(), 'a.md', {} as never);

        expect(m.warnings()).toHaveLength(1);
    });

    it('does not log an empty markdown left empty', async () => {
        const m = await load();
        render.mockResolvedValue(undefined);

        m.renderCardMarkdown({} as never, '  ', el(), 'a.md', {} as never);

        expect(m.warnings()).toEqual([]);
    });

    it('settles and logs when the render fails', async () => {
        const m = await load();
        render.mockImplementation((_app, _md, target: { children: unknown[] }) => {
            target.children.push({});
            return Promise.reject(new Error('boom'));
        });

        await expect(m.renderCardMarkdown({} as never, '- [ ] a', el(), 'a.md', {} as never)).resolves.toBeUndefined();
        expect(m.errors().map(e => e.message)).toEqual([expect.stringContaining('boom')]);
    });
});
