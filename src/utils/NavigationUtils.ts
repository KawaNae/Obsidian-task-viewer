import { type App, MarkdownView, TFile, type WorkspaceLeaf } from 'obsidian';
import type { Task } from '../types';

/** The Markdown tab that already shows the file, in any window (pop-outs included). */
function findExistingTab(app: App, filePath: string): WorkspaceLeaf | null {
    const leaves = app.workspace.getLeavesOfType('markdown');
    return leaves.find(leaf => {
        const view = leaf.view;
        return view instanceof MarkdownView && view.file?.path === filePath;
    }) ?? null;
}

/**
 * Opens a note and answers the leaf that shows it. With `reuseTab`, a tab
 * already showing the note is focused; otherwise, or when none is, the note
 * opens in a new tab. `eState` reaches the leaf that shows the note — a new
 * tab gets it with the open, an existing one through `setEphemeralState` —
 * so the leaf itself, not whichever view is active later, acts on it.
 * Every path by which the plugin opens a note comes through here.
 */
export async function openFile(
    app: App,
    filePath: string,
    reuseTab: boolean,
    eState?: Record<string, unknown>,
): Promise<WorkspaceLeaf | null> {
    const existing = reuseTab ? findExistingTab(app, filePath) : null;
    if (existing) {
        app.workspace.setActiveLeaf(existing, { focus: true });
        if (eState) existing.setEphemeralState(eState);
        return existing;
    }
    const file = app.vault.getAbstractFileByPath(filePath);
    if (!(file instanceof TFile)) return null;
    const leaf = app.workspace.getLeaf('tab');
    await leaf.openFile(file, { active: true, eState });
    return leaf;
}

/**
 * リンクテキスト（wikilink等）を解決して既存タブに移動、なければ新規タブで開く。
 */
export function openLinkInExistingOrNewTab(app: App, linktext: string, sourcePath: string): void {
    const linkPath = linktext.split('#')[0].split('|')[0];
    const resolved = app.metadataCache.getFirstLinkpathDest(linkPath, sourcePath);
    const existing = resolved ? findExistingTab(app, resolved.path) : null;
    if (existing) {
        app.workspace.setActiveLeaf(existing, { focus: true });
        return;
    }
    void app.workspace.openLinkText(linktext, sourcePath, true);
}

/** Opens the task's note at the task's line: the leaf that shows the note moves to the line. */
export function openTaskInEditor(app: App, task: Task, reuseTab: boolean): void {
    void openFile(app, task.file, reuseTab, { line: task.line });
}
