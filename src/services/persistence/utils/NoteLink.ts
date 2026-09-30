import type { FileManager, TFile } from 'obsidian';

/**
 * The link a row sent to a note leaves where it stood, spelt as the user's
 * settings spell a new link (`generateMarkdownLink`): wikilink or Markdown,
 * and the shortest path, the relative one or the absolute one, seen from the
 * note the row is in (`sourcePath`).
 *
 * The link always shows the note's name. Obsidian drops a display text that
 * reads as the link does (measured at stage 0), so a note the shortest path
 * names by its name alone is linked as `[[Note]]`, and one it has to name by
 * its path, since another note has its name, as `[[Folder/Note|Note]]`: the
 * row reads the note's name either way, and whether the path is needed is
 * Obsidian's to answer, not ours.
 */
export function noteLink(
    fileManager: Pick<FileManager, 'generateMarkdownLink'>,
    note: TFile,
    sourcePath: string,
): string {
    return fileManager.generateMarkdownLink(note, sourcePath, undefined, note.basename);
}
