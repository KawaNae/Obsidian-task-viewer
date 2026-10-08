import { TFile } from 'obsidian';
import type { App } from 'obsidian';

/**
 * An app for link and tag completion (`LinkTagCandidates`): its files, their
 * frontmatter and headings, the unresolved links, the tags, and the link
 * settings. `fileToLinktext` names a file as Obsidian's shortest path does:
 * by its name (a note's without `.md` when asked to omit it, another file's
 * with its extension) when it is the one file of the vault by that name,
 * by its path otherwise. `getFirstLinkpathDest` finds a note by its name or
 * path, case aside, and the note the link is in by ''.
 */
export interface LinkAppSpec {
    /** Paths, oldest first: each a minute newer than the one before. */
    files: string[];
    frontmatter?: Record<string, Record<string, unknown>>;
    headings?: Record<string, { heading: string; level: number }[]>;
    unresolved?: Record<string, Record<string, number>>;
    tags?: string[];
    markdown?: boolean;
}

export function linkFile(path: string, mtime = 0): TFile {
    const name = path.split('/').pop()!;
    const dot = name.lastIndexOf('.');
    return Object.assign(new TFile(), {
        path,
        name,
        basename: dot > 0 ? name.slice(0, dot) : name,
        extension: dot > 0 ? name.slice(dot + 1) : '',
        stat: { mtime, ctime: 0, size: 0 },
    });
}

export function linkApp(spec: LinkAppSpec): App {
    const files = spec.files.map((path, i) => linkFile(path, (i + 1) * 60_000));
    const named = (file: TFile) => files.filter(f => f.name.toLowerCase() === file.name.toLowerCase()).length === 1;
    return {
        vault: {
            getFiles: () => files,
            getConfig: (key: string) => (key === 'useMarkdownLinks' ? spec.markdown ?? false : undefined),
        },
        metadataCache: {
            getFileCache: (file: TFile) => ({
                frontmatter: spec.frontmatter?.[file.path],
                headings: (spec.headings?.[file.path] ?? []).map((h, i) => ({ ...h, position: { start: { line: i } } })),
            }),
            unresolvedLinks: spec.unresolved ?? {},
            getTags: () => Object.fromEntries((spec.tags ?? []).map(tag => [`#${tag}`, 1])),
            getFirstLinkpathDest: (linkpath: string, source: string) => {
                if (linkpath === '') return files.find(f => f.path === source) ?? null;
                const wanted = linkpath.toLowerCase();
                return files.find(f => f.path.toLowerCase() === wanted || f.path.toLowerCase() === `${wanted}.md`)
                    ?? files.find(f => f.extension === 'md' && f.basename.toLowerCase() === wanted)
                    ?? null;
            },
            fileToLinktext: (file: TFile, _source: string, omitMd = true) => {
                const omit = omitMd && file.extension === 'md';
                if (named(file)) return omit ? file.basename : file.name;
                return omit ? file.path.replace(/\.md$/, '') : file.path;
            },
        },
    } as unknown as App;
}
