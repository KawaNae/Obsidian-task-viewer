import type { TFile } from 'obsidian';

/** The link settings Obsidian spells a new link by: the path it names, and wikilink or Markdown. */
export interface LinkSettings {
    newLinkFormat: 'shortest' | 'relative' | 'absolute';
    useMarkdownLinks: boolean;
}

/**
 * A stand-in for `fileManager.generateMarkdownLink`, spelling links as
 * Obsidian 1.13.7 was measured to at stage 0
 * (`stages/s0-measure/observation.md`, 2):
 *
 * - shortest: the note's name when it is the one note of the vault by that
 *   name, case aside; its path without `.md` when another has it, or when
 *   the vault does not hold the note (measured at stage A2: a note not made
 *   yet is named by its path). relative: the path from the linking
 *   note's folder, the name alone in the same folder. absolute: the path
 *   from the vault's root.
 * - A wikilink drops a display text that reads as the link does; one that
 *   reads otherwise follows a `|`.
 * - A Markdown link always shows a text — the note's name when none is
 *   given — and names the path with `.md`, its spaces as `%20`.
 *
 * `files` are the paths of the vault's notes, asked at each link.
 */
export function linkDouble(files: () => readonly string[], settings: LinkSettings = { newLinkFormat: 'shortest', useMarkdownLinks: false }) {
    return (file: TFile, sourcePath: string, subpath = '', alias = ''): string => {
        const bare = file.path.replace(/\.md$/, '');
        let linktext: string;
        switch (settings.newLinkFormat) {
            case 'absolute':
                linktext = bare;
                break;
            case 'relative':
                linktext = relative(folderOf(sourcePath), bare);
                break;
            case 'shortest': {
                const folded = file.basename.toLowerCase();
                const named = files().filter(p => baseOf(p).toLowerCase() === folded);
                linktext = named.length === 1 && named[0] === file.path ? file.basename : bare;
                break;
            }
        }
        if (settings.useMarkdownLinks) {
            const shown = alias || file.basename;
            return `[${shown}](${`${linktext}.md`.replace(/ /g, '%20')}${subpath})`;
        }
        return `[[${linktext}${subpath}${alias && alias !== linktext ? `|${alias}` : ''}]]`;
    };
}

function baseOf(path: string): string {
    return (path.split('/').pop() ?? path).replace(/\.md$/, '');
}

function folderOf(path: string): string[] {
    return path.split('/').slice(0, -1);
}

/** `to` (a path) as seen from the folder `from`: `..` for each folder to climb, then down. */
function relative(from: string[], to: string): string {
    const parts = to.split('/');
    let shared = 0;
    while (shared < from.length && shared < parts.length - 1 && from[shared] === parts[shared]) shared++;
    return [...from.slice(shared).map(() => '..'), ...parts.slice(shared)].join('/');
}
