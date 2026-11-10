import { describe, expect, it, vi } from 'vitest';
import { App, MarkdownView, TFile } from 'obsidian';
import { openFile, openLink, openTaskInEditor } from '../../../src/utils/NavigationUtils';
import type { Task } from '../../../src/types';

/**
 * What these tests hold is the leaf's side: the leaf that shows the note is
 * answered and is handed the line. That Obsidian's Markdown view then moves
 * the cursor to `eState.line` is not observable here; the E2E run checks it.
 */

function fileAt(path: string): TFile {
    const file = new TFile();
    file.path = path;
    return file;
}

function leafShowing(path: string) {
    const view = new MarkdownView() as MarkdownView & { file: TFile };
    view.file = fileAt(path);
    return { view, setEphemeralState: vi.fn(), openFile: vi.fn() };
}

function appWith(opts: { files: string[]; open: ReturnType<typeof leafShowing>[] }) {
    const app = new App();
    const newLeaf = { view: {}, openFile: vi.fn(async () => {}), setEphemeralState: vi.fn() };
    app.vault.getAbstractFileByPath = ((p: string) => (opts.files.includes(p) ? fileAt(p) : null)) as any;
    app.workspace = {
        getLeavesOfType: vi.fn(() => opts.open),
        setActiveLeaf: vi.fn(),
        getLeaf: vi.fn(() => newLeaf),
    };
    return { app, newLeaf };
}

describe('openFile', () => {
    it('focuses a tab already showing the note and hands it the eState', async () => {
        const tab = leafShowing('a.md');
        const { app, newLeaf } = appWith({ files: ['a.md'], open: [tab] });

        const leaf = await openFile(app, 'a.md', true, { line: 4 });

        expect(leaf).toBe(tab);
        expect(app.workspace.setActiveLeaf).toHaveBeenCalledWith(tab, { focus: true });
        expect(tab.setEphemeralState).toHaveBeenCalledWith({ line: 4 });
        expect(newLeaf.openFile).not.toHaveBeenCalled();
    });

    it('opens the note in a new tab with the eState when no tab shows it', async () => {
        const { app, newLeaf } = appWith({ files: ['a.md'], open: [leafShowing('b.md')] });

        const leaf = await openFile(app, 'a.md', true, { line: 4 });

        expect(leaf).toBe(newLeaf);
        expect(app.workspace.getLeaf).toHaveBeenCalledWith('tab');
        const [file, state] = newLeaf.openFile.mock.calls[0] as unknown as [TFile, unknown];
        expect(file.path).toBe('a.md');
        expect(state).toEqual({ active: true, eState: { line: 4 } });
    });

    it('opens a new tab without looking for one when tabs are not reused', async () => {
        const tab = leafShowing('a.md');
        const { app, newLeaf } = appWith({ files: ['a.md'], open: [tab] });

        const leaf = await openFile(app, 'a.md', false);

        expect(leaf).toBe(newLeaf);
        expect(tab.setEphemeralState).not.toHaveBeenCalled();
    });

    it('answers null for a path that is not a file', async () => {
        const { app, newLeaf } = appWith({ files: [], open: [] });

        expect(await openFile(app, 'gone.md', true)).toBeNull();
        expect(newLeaf.openFile).not.toHaveBeenCalled();
    });
});

describe('openLink', () => {
    /** An app in which the link path `a` names `Folder/a.md`, with the tabs `open`. */
    function linking(open: ReturnType<typeof leafShowing>[]) {
        const { app } = appWith({ files: ['Folder/a.md'], open });
        app.metadataCache.getFirstLinkpathDest = ((path: string) => (path === 'a' ? fileAt('Folder/a.md') : null)) as any;
        app.workspace.openLinkText = vi.fn(async () => {});
        return app;
    }

    it('focuses a tab already showing the note and moves it to the section the link names', () => {
        const tab = leafShowing('Folder/a.md');
        const app = linking([tab]);

        openLink(app, 'a#Parent#Child', 'from.md', true);

        expect(app.workspace.setActiveLeaf).toHaveBeenCalledWith(tab, { focus: true });
        expect(tab.setEphemeralState).toHaveBeenCalledWith({ subpath: '#Parent#Child' });
        expect(app.workspace.openLinkText).not.toHaveBeenCalled();
    });

    it('focuses the tab and leaves it where it is for a link that names no section', () => {
        const tab = leafShowing('Folder/a.md');
        const app = linking([tab]);

        openLink(app, 'a|shown as', 'from.md', true);

        expect(app.workspace.setActiveLeaf).toHaveBeenCalledWith(tab, { focus: true });
        expect(tab.setEphemeralState).not.toHaveBeenCalled();
    });

    it('opens the link in a new tab when no tab shows the note, or tabs are not reused', () => {
        const tab = leafShowing('Folder/a.md');
        const none = linking([leafShowing('b.md')]);
        openLink(none, 'a#Child', 'from.md', true);
        expect(none.workspace.openLinkText).toHaveBeenCalledWith('a#Child', 'from.md', true);

        const fresh = linking([tab]);
        openLink(fresh, 'a#Child', 'from.md', false);
        expect(fresh.workspace.openLinkText).toHaveBeenCalledWith('a#Child', 'from.md', true);
        expect(tab.setEphemeralState).not.toHaveBeenCalled();
        expect(fresh.workspace.setActiveLeaf).not.toHaveBeenCalled();
    });
});

describe('openTaskInEditor', () => {
    it('hands the task line to the leaf without waiting on a timer', async () => {
        vi.useFakeTimers();
        try {
            const tab = leafShowing('a.md');
            const { app } = appWith({ files: ['a.md'], open: [tab] });

            openTaskInEditor(app, { file: 'a.md', line: 7 } as Task, true);

            expect(tab.setEphemeralState).toHaveBeenCalledWith({ line: 7 });
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });
});
