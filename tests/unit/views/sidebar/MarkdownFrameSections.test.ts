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
 * it is handed. The placement holds the state's frames as the panel does,
 * and has the frames take them whenever it writes them.
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
    let state: { frames: SidebarFrame[]; collapsed: Record<string, boolean> } = { frames: [], collapsed: {} };
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
        relink: (links) => {
            relinked.push(new Map(links));
            const frames = state.frames.map(frame =>
                frame.kind === 'markdown' && links.has(frame.id) ? { ...frame, link: links.get(frame.id)! } : frame);
            show(frames, state.collapsed);
        },
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
    /** The state's frames are `frames` now, folded as `collapsed` says: the panel has the frames take them at once. */
    const show = (frames: SidebarFrame[], collapsed: Record<string, boolean> = {}) => {
        state = { frames, collapsed };
        sections.sync(frames, collapsed);
    };
    /** Rename `file` to `path`, as Obsidian does: its path is new when the vault reports it. */
    const rename = (file: TFile, path: string) => {
        files.delete(file.path.replace(/\.md$/, ''));
        texts.set(path, texts.get(file.path) ?? '');
        file.path = path;
        file.name = path.split('/').pop()!;
        file.basename = file.name.replace(/\.[^.]+$/, '');
        file.extension = file.name.split('.').pop() ?? '';
        files.set(path.replace(/\.md$/, ''), file);
        handlers.get('rename')?.(file);
    };
    return {
        sections,
        show,
        rename,
        reads,
        relinked,
        /** The state's links, by frame id. */
        links: () => Object.fromEntries(state.frames.flatMap(f => f.kind === 'markdown' ? [[f.id, f.link]] : [])),
        views: () => views.made as StandInView[],
        /** A note at `path`, which a link names by its path without `.md`, holding `text`. */
        note(path: string, text = '') {
            const file = makeFile(path);
            files.set(path.replace(/\.md$/, ''), file);
            texts.set(path, text);
            return file;
        },
        /**
         * Rename the folder `from` to `to`, as Obsidian does: the folder is
         * reported first, its notes' paths still old, and then each note,
         * its path made new just before it is reported.
         */
        renameFolder(from: string, to: string, notes: TFile[]) {
            handlers.get('rename')?.({ path: to, name: to.split('/').pop() } as unknown as TFile);
            for (const note of notes) rename(note, to + note.path.slice(from.length));
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
        frames.show([LIST, memo('m', 'Folder/Note#Memo')], { m: true });
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
        frames.show([memo('m', 'Folder/Note#Memo'), memo('g', 'Folder/Note#Memo')], {});
        const [m, g] = frames.views();

        frames.show([memo('m', 'Other#Memo')], { m: true });
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
        frames.show([memo('m', 'Note#Memo')], {});
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
        frames.show([memo('a', 'One#Memo'), memo('b', 'Two#Memo')], {});
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
        frames.show([memo('m', 'Folder/Note#Memo'), memo('n', 'Note#Memo'), memo('e', 'Else#Memo')], {});
        await settle();

        frames.rename(note, 'Moved/Renamed.md');
        expect(frames.relinked).toEqual([new Map([['m', 'Moved/Renamed#Memo']])]);
        await settle();
        const [m] = frames.views();
        expect(m.shown.map(r => r.reading.kind)).toEqual(['heading', 'heading']);
        expect(m.shown.at(-1)?.path).toBe('Moved/Renamed.md');
    });

    it('follows a note renamed right after its frame was added, before anything was read or drawn', async () => {
        const frames = framesOver();
        const note = frames.note('Note.md', '# Memo\nbody');
        frames.sections.open();
        frames.show([memo('m', 'Note#Memo')]);

        frames.rename(note, 'Moved/Note.md');
        expect(frames.links()).toEqual({ m: 'Moved/Note#Memo' });
        await settle();
        expect(frames.views()[0].shown.at(-1)).toMatchObject({ reading: { markdown: 'body' }, path: 'Moved/Note.md' });
    });

    it('follows each note of a renamed folder as it is reported, and writes nothing at the folder', async () => {
        const frames = framesOver();
        const one = frames.note('Old/One.md', '# Memo\none');
        const two = frames.note('Old/Two.md', '# Memo\ntwo');
        frames.sections.open();
        frames.show([memo('a', 'Old/One#Memo'), memo('b', 'Old/Two#Memo')]);
        await settle();

        frames.renameFolder('Old', 'New', [one, two]);
        // One write per note reported, each once its path is new; none at the folder.
        expect(frames.relinked).toEqual([
            new Map([['a', 'New/One#Memo']]),
            new Map([['b', 'New/Two#Memo']]),
        ]);
        expect(frames.links()).toEqual({ a: 'New/One#Memo', b: 'New/Two#Memo' });
        await settle();
        expect(frames.views().map(v => v.shown.at(-1))).toMatchObject([
            { reading: { markdown: 'one' }, path: 'New/One.md' },
            { reading: { markdown: 'two' }, path: 'New/Two.md' },
        ]);
    });

    it('writes nothing for a note no frame shows, nor for one renamed before the vault\'s files are known', async () => {
        const frames = framesOver();
        frames.note('Note.md', '# Memo\nbody');
        const other = frames.note('Other.md');
        frames.sections.open();
        frames.show([memo('m', 'Note#Memo')]);
        frames.rename(other, 'Elsewhere/Other.md');
        expect(frames.relinked).toEqual([]);

        const loading = framesOver({ ready: false });
        const note = loading.note('Note.md', '# Memo\nbody');
        loading.sections.open();
        loading.show([memo('m', 'Note#Memo')]);
        loading.rename(note, 'Moved/Note.md');
        expect(loading.relinked).toEqual([]);
        expect(loading.links()).toEqual({ m: 'Note#Memo' });
    });

    it('does not follow its note to another extension: the frame says the note is not there', async () => {
        const frames = framesOver();
        const note = frames.note('Note.md', '# Memo\nbody');
        frames.sections.open();
        frames.show([memo('m', 'Note#Memo')]);
        await settle();
        frames.rename(note, 'Note.txt');
        expect(frames.relinked).toEqual([]);
        expect(frames.views()[0].shown.at(-1)).toMatchObject({ reading: { kind: 'no-note' }, path: null });
    });

    it('reads the note a link names once the state\'s link is changed from outside', async () => {
        const frames = framesOver();
        frames.note('One.md', '# Memo\none');
        const two = frames.note('Two.md', '# Memo\ntwo');
        frames.sections.open();
        frames.show([memo('m', 'One#Memo')]);
        await settle();
        frames.show([memo('m', 'Two#Memo')]);
        await settle();
        expect(frames.reads.at(-1)).toBe(two);
        expect(frames.views()[0].shown.at(-1)).toMatchObject({ reading: { markdown: 'two' }, path: 'Two.md' });
    });

    it('reads again at a saved setting, and stops hearing the vault and ends its frames at close', async () => {
        const frames = framesOver();
        const note = frames.note('Note.md', '# Memo\nbody');
        frames.sections.open();
        frames.show([memo('m', 'Note#Memo')], {});
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
