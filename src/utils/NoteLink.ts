import type { FileManager, TFile } from 'obsidian';

/**
 * A link to `file`, spelt as the user's settings spell a new link
 * (`generateMarkdownLink`): wikilink or Markdown, and the shortest path, the
 * relative one or the absolute one, seen from the note the link is written
 * in (`sourcePath`). `subpath` points into the file (`#heading`); `display`
 * is the text the link shows.
 *
 * Obsidian drops a display text that reads as the link does (measured at
 * stage 0), so a note the shortest path names by its name alone, shown by
 * its name, is linked as `[[Note]]`, and one it has to name by its path,
 * since another note has its name, as `[[Folder/Note|Note]]`: whether the
 * path is needed is Obsidian's to answer, not ours. A link with a subpath
 * keeps its display text (`[[Note#h|Note]]`), so a heading's link is asked
 * without one.
 *
 * The one spelling of a link to a file the plugin writes: the link a row
 * sent to a note leaves where it stood (`SendWriter`), and the link a
 * candidate of `[[` writes.
 */
export function noteLink(
    fileManager: Pick<FileManager, 'generateMarkdownLink'>,
    file: TFile,
    sourcePath: string,
    opts: { subpath?: string; display?: string } = {},
): string {
    return fileManager.generateMarkdownLink(file, sourcePath, opts.subpath, opts.display);
}
