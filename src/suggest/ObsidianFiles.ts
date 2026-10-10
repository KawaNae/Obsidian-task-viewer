import type { App, TFile } from 'obsidian';

/**
 * Obsidian's own answers about a file as a link's candidate, read here and
 * nowhere else: whether its `[[` lists a file, and whether a path is one the
 * user's "Excluded files" leave out.
 *
 * `MetadataCache.isSupportedFile` and `isUserIgnored` are not in Obsidian's
 * typings. Obsidian lists a file under `[[` when it shows unsupported files
 * or a view is registered for its extension, which other plugins add to
 * (`note-suggest-design.md`, 観察で足したこと); a fixed list of extensions
 * would leave theirs out. Being unpublished, they may go or change, so each
 * is read with the answer it falls back to, as `ObsidianConfig` reads the
 * settings.
 */

interface CandidateReading {
    isSupportedFile?: (file: TFile) => boolean;
    isUserIgnored?: (path: string) => boolean;
}

/**
 * The extensions Obsidian 1.13.7 registers a view for out of the box
 * (`viewRegistry.typeByExtension` of a vault with no plugin adding one):
 * what is listed when `isSupportedFile` cannot be asked.
 */
const DEFAULT_EXTENSIONS = new Set([
    'md',
    'bmp', 'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'avif',
    'mp3', 'wav', 'm4a', '3gp', 'flac', 'ogg', 'oga', 'opus',
    'mp4', 'webm', 'ogv', 'mov', 'mkv',
    'pdf', 'canvas', 'base',
]);

function reading(app: App): CandidateReading {
    return app.metadataCache as unknown as CandidateReading;
}

/** Whether Obsidian lists `file` as a link's candidate; by the default extensions when it cannot be asked, or it threw. */
export function isLinkable(app: App, file: TFile): boolean {
    const ask = reading(app).isSupportedFile;
    if (typeof ask === 'function') {
        try {
            return ask.call(app.metadataCache, file) === true;
        } catch {
            // the default extensions, below
        }
    }
    return DEFAULT_EXTENSIONS.has(file.extension.toLowerCase());
}

/** Whether `path` is one of the user's "Excluded files"; false when it cannot be asked, or it threw. */
export function isIgnored(app: App, path: string): boolean {
    const ask = reading(app).isUserIgnored;
    if (typeof ask !== 'function') return false;
    try {
        return ask.call(app.metadataCache, path) === true;
    } catch {
        return false;
    }
}
