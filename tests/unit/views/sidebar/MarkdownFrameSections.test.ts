import { describe, expect, it, vi } from 'vitest';
import type { TFile } from 'obsidian';
import { DEFAULT_SETTINGS, type SidebarFrame } from '../../../../src/types';
import type { FrameRead } from '../../../../src/views/sidebar/MarkdownFrameReader';
import { MarkdownFrameSections, type MarkdownFrameDeps, type MarkdownFramePlacement } from '../../../../src/views/sidebar/MarkdownFrameSections';
import { makeFile } from '../../helpers/vaultSession';

/**
 * The markdown frames of a sidebar, over a vault of the test's: the frames
 * the state holds are made, kept and ended by id, and follow their notes as
 * the vault reports them. A frame's view is stood in for, and records what
 * it is handed.
 */
const views = vi.hoisted(() => ({ made: [] as unknown[] }));

vi.mock('../../../../src/views/sidebar/MarkdownFrameView', () => ({
    MarkdownFrameView: class {
        readonly shown: FrameRead[] = [];
        readonly folds: boolean[] = [];
        closed = false;
        readonly root = { removed: false, remove() { this.removed = true; } };
        constructor(readonly host: unknown, readonly id: string, readonly title: string, collapsed: boolean) {
            this.folds.push(collapsed);
            views.made.push(this);
        }
        show(read: FrameRead) { this.shown.push(read); }
        setCollapsed(collapsed: boolean) { this.folds.push(collapsed); }
        paint() {}
        close() { this.closed = true; }
    },
}));

interface StandInView {
    id: string;
    title: string;
    shown: FrameRead[];
    folds: boolean[];
    closed: boolean;
    root: { removed: boolean };
}

const memo = (id: string, link: string): SidebarFrame => ({ kind: 'markdown', id, link });
const LIST: SidebarFrame = { kind: 'list', id: 'l', name: 'L', filterState: { filters: [], logic: 'and' }, applyViewFilter: false };

/** Markdown frames over a vault whose files are known once `ready` is, with what they wrote through their placement. */
function framesOver(options: { ready?: boolean } = {}) {
    views.made = [];
    const files = new Map<string, TFile>();
    const handlers = new Map<string, (file: TFile) => void>();
    const layoutReady: (() => void)[] = [];
    const reads: TFile[] = [];
    const texts = new Map<string, string>();
    const workspace = {
        layoutReady: options.ready ?? true,
        onLayoutReady: (run: () => void) => { if (workspace.layoutReady) run(); else layoutReady.push(run); },
    };
    const app = {
        workspace,
        metadataCache: { getFirstLinkpathDest: (path: string) => files.get(path) ?? null },
        vault: {
            on: (name: string, handler: (file: TFile) => void) => { handlers.set(name, handler); return { name }; },
            offref: (ref: { name: string }) => { handlers.delete(ref.name); },
            cachedRead: async (file: TFile) => { reads.push(file); return texts.get(file.path) ?? ''; },
        },
    };
    const relinked: Map<string, string>[] = [];
    const placement: MarkdownFramePlacement = {
        rowClasses: { header: 'h', toggle: 't', name: 'n', button: 'b', collapsed: 'c' },
        relink: links => { relinked.push(new Map(links)); },
        setCollapsed: () => {},
        remove: () => {},
        appendMenuItems: () => {},
        masked: () => false,
    };
    const deps = {
        plugin: { app, settings: DEFAULT_SETTINGS },
        links: {},
        getHoverParent: () => ({}),
    } as unknown as MarkdownFrameDeps;
    const sections = new MarkdownFrameSections(deps, placement, {} as HTMLElement);
    return {
        sections,
        reads,
        relinked,
        views: () => views.made as StandInView[],
        /** A note at `path`, which a link names by its path without `.md`, holding `text`. */
        note(path: string, text = '') {
            const file = makeFile(path);
            files.set(path.replace(/\.md$/, ''), file);
            texts.set(path, text);
            return file;
        },
        /** Rename `file` to `path` and have the vault report it, as Obsidian does. */
        rename(file: TFile, path: string) {
            files.delete(file.path.replace(/\.md$/, ''));
            texts.set(path, texts.get(file.path) ?? '');
            file.path = path;
            file.basename = path.split('/').pop()!.replace(/\.md$/, '');
            files.set(path.replace(/\.md$/, ''), file);
            handlers.get('rename')?.(file);
        },
        modify: (file: TFile) => handlers.get('modify')?.(file),
        heard: () => [...handlers.keys()],
        /** The vault's files are known now. */
        ready() {
            workspace.layoutReady = true;
            for (const run of layoutReady.splice(0)) run();
        },
    };
}

/** Let the readings begun end. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

describe('the markdown frames of a sidebar', () => {
    it('makes a frame for each markdown frame of the state, by id, folded as the state says, and none for a list', async () => {
        const frames = framesOver();
        const note = frames.note('Folder/Note.md', '# Memo\nbody');
        frames.sections.open();
        frames.sections.sync([LIST, memo('m', 'Folder/Note#Memo')], { m: true });
        expect(frames.views().map(v => [v.id, v.title, v.folds])).toEqual([['m', 'Memo', [true]]]);
        await settle();
        expect(frames.reads).toEqual([note]);
        expect(frames.views()[0].shown).toMatchObject([{ reading: { kind: 'heading', markdown: 'body' }, path: 'Folder/Note.md' }]);
    });

    it('keeps a frame by its id: its link and fold are taken, and a frame gone from the state is ended', async () => {
        const frames = framesOver();
        frames.note('Folder/Note.md', '# Memo\none');
        frames.note('Other.md', '# Memo\ntwo');
        frames.sections.open();
        frames.sections.sync([memo('m', 'Folder/Note#Memo'), memo('g', 'Folder/Note#Memo')], {});
        const [m, g] = frames.views();

        frames.sections.sync([memo('m', 'Other#Memo')], { m: true });
        expect(frames.views()).toHaveLength(2);
        expect(m.folds).toEqual([false, true]);
        expect([g.closed, g.root.removed]).toEqual([true, true]);
        await settle();
        expect(m.shown.at(-1)).toMatchObject({ reading: { markdown: 'two' }, path: 'Other.md' });
        expect(g.shown).toEqual([]);
    });

    it('looks for no note before the vault\'s files are known, and for every frame\'s once they are', async () => {
        const frames = framesOver({ ready: false });
        const note = frames.note('Note.md', '# Memo\nbody');
        frames.sections.open();
        frames.sections.sync([memo('m', 'Note#Memo')], {});
        await settle();
        expect(frames.reads).toEqual([]);
        frames.ready();
        await settle();
        expect(frames.reads).toEqual([note]);
    });

    it('reads again the frames whose note is written to, and no other', async () => {
        const frames = framesOver();
        const one = frames.note('One.md', '# Memo\na');
        const two = frames.note('Two.md', '# Memo\nb');
        frames.sections.open();
        frames.sections.sync([memo('a', 'One#Memo'), memo('b', 'Two#Memo')], {});
        await settle();
        frames.modify(one);
        await settle();
        expect(frames.reads).toEqual([one, two, one]);
    });

    it('writes the new link of each frame whose note was renamed through the placement, at once, and reads the note at its new path', async () => {
        const frames = framesOver();
        const note = frames.note('Folder/Note.md', '# Memo\nbody');
        frames.note('Else.md', '# Memo\nelse');
        frames.sections.open();
        frames.sections.sync([memo('m', 'Folder/Note#Memo'), memo('n', 'Note#Memo'), memo('e', 'Else#Memo')], {});
        await settle();

        frames.rename(note, 'Moved/Renamed.md');
        expect(frames.relinked).toEqual([new Map([['m', 'Moved/Renamed#Memo']])]);
        await settle();
        const [m] = frames.views();
        expect(m.shown.map(r => r.reading.kind)).toEqual(['heading', 'heading']);
        expect(m.shown.at(-1)?.path).toBe('Moved/Renamed.md');
    });

    it('reads again at a saved setting, and stops hearing the vault and ends its frames at close', async () => {
        const frames = framesOver();
        const note = frames.note('Note.md', '# Memo\nbody');
        frames.sections.open();
        frames.sections.sync([memo('m', 'Note#Memo')], {});
        await settle();
        frames.sections.settingsSaved();
        await settle();
        expect(frames.reads).toEqual([note, note]);

        frames.sections.close();
        expect(frames.heard()).toEqual([]);
        expect(frames.views()[0].closed).toBe(true);
        frames.sections.settingsSaved();
        await settle();
        expect(frames.reads).toEqual([note, note]);
    });
});
