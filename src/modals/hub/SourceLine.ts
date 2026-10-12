import { MarkdownView, TFile, type App, type WorkspaceLeaf } from 'obsidian';
import type { Task } from '../../types';
import type { IndexReads } from '../../services/core/TaskIndex';
import { contentKeyOf } from '../../services/core/ContentKey';
import { splitLines } from '../../services/persistence/FileLines';
import { PropertyKey } from '../../services/parsing/utils/PropertyKey';
import { openFile } from '../../utils/NavigationUtils';
import { hostWindow } from '../../utils/HostWindow';

/**
 * A line of the row's note the hub opens: a line of the row's reading (the
 * coordinates of `Task.line`), null when the reading holds none for it; and
 * for a frontmatter key, the key, which the Properties view shows apart
 * from the lines.
 */
export interface LineTarget {
    line: number | null;
    frontmatterKey?: string;
}

export interface SourceLineDeps {
    app: App;
    index: IndexReads;
    reuseTab: boolean;
}

/** How long a property of the Properties view stays lit, as Obsidian lights a line. */
const FLASH_MS = 1500;

/**
 * Open the row's note at a line of it and light the line: the line an
 * inherited value is written on, or the one a finding is on.
 *
 * The line is one of the row's reading, and the note may read otherwise
 * now: it is carried to the content the note's editor shows (or the file
 * holds) by the index (`IndexReads.followLine`), which follows it across our
 * own writes. When that content is not the index's last reading (an edit
 * not saved yet, a scan not done), the editor is saved and the note read,
 * and the target is found again (`locate`) on the row's copy of that
 * reading. A line that cannot be carried is not guessed: the note is opened
 * where it opens.
 *
 * A line is lit by the leaf (`setEphemeralState({ line })`: the cursor on
 * it, and Obsidian's flash). A frontmatter key the Properties view shows is
 * lit there instead: in Live Preview the frontmatter's lines are not in the
 * editor, and the line would put the cursor at the top of the body.
 */
export async function openSourceLine(
    deps: SourceLineDeps,
    task: Task,
    locate: (task: Task) => LineTarget | null,
): Promise<void> {
    const target = locate(task);
    let line = target ? await lineNow(deps, task, target.line) : null;
    if (target && target.line !== null && line === null) {
        const fresh = await reread(deps, task);
        const again = fresh ? locate(fresh) : null;
        if (fresh && again) line = await lineNow(deps, fresh, again.line);
    }

    if (target?.frontmatterKey !== undefined) {
        const leaf = await openFile(deps.app, task.file, deps.reuseTab);
        if (leaf) await nextFrame(leaf);
        if (leaf && flashProperty(leaf, target.frontmatterKey)) return;
        if (leaf && line !== null) leaf.setEphemeralState({ line });
        return;
    }
    await openFile(deps.app, task.file, deps.reuseTab, line !== null ? { line } : undefined);
}

/** Where line `line` of the row's reading stands in the note now: in the content its editor shows, or the file holds. */
async function lineNow(deps: SourceLineDeps, task: Task, line: number | null): Promise<number | null> {
    if (line === null || !task.reading) return null;
    const lines = editorOf(deps.app, task.file)?.lines ?? (await fileLines(deps.app, task.file));
    if (!lines) return null;
    return deps.index.followLine(task.file, task.reading, line, contentKeyOf(lines));
}

/** The row's copy once the note's editor is saved and the note read again; undefined when the row is no longer named so. */
async function reread(deps: SourceLineDeps, task: Task): Promise<Task | undefined> {
    const file = deps.app.vault.getAbstractFileByPath(task.file);
    if (!(file instanceof TFile)) return undefined;
    await editorOf(deps.app, task.file)?.view.save();
    await deps.index.requestScan(file);
    return deps.index.getTask(task.id);
}

/** The editor that shows the note, and the lines it shows; null when no tab shows it. */
function editorOf(app: App, path: string): { view: MarkdownView; lines: string[] } | null {
    for (const leaf of app.workspace.getLeavesOfType('markdown')) {
        const view = leaf.view;
        if (!(view instanceof MarkdownView) || view.file?.path !== path) continue;
        const editor = view.editor;
        const lines: string[] = [];
        for (let n = 0; n < editor.lineCount(); n++) lines.push(editor.getLine(n));
        return { view, lines };
    }
    return null;
}

async function fileLines(app: App, path: string): Promise<string[] | null> {
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return null;
    return splitLines(await app.vault.read(file)).lines;
}

/**
 * Light the property `key` (its case aside) in the Properties view the
 * leaf shows: scrolled to and flashed as Obsidian flashes a line. False
 * when the view shows no such property (source mode, the view hidden, the
 * reading view).
 */
function flashProperty(leaf: WorkspaceLeaf, key: string): boolean {
    const container = (leaf.view as { containerEl?: HTMLElement }).containerEl;
    if (!container) return false;
    const property = Array.from(container.querySelectorAll<HTMLElement>('.metadata-property[data-property-key]'))
        .find(el => PropertyKey.same(el.dataset.propertyKey ?? '', key) && el.offsetParent !== null);
    if (!property) return false;
    property.scrollIntoView({ block: 'center' });
    property.addClass('is-flashing');
    hostWindow(property).setTimeout(() => property.removeClass('is-flashing'), FLASH_MS);
    return true;
}

/** The next frame of the window the leaf is in: a leaf just opened has drawn its Properties view by then. */
function nextFrame(leaf: WorkspaceLeaf): Promise<void> {
    const win = hostWindow((leaf.view as { containerEl?: HTMLElement }).containerEl);
    return new Promise(resolve => win.requestAnimationFrame(() => resolve()));
}
