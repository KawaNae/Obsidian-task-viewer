/**
 * What one markdown frame of the sidebar reads: the note its link names,
 * and the section of it the link names, read off the note's lines. It holds
 * no element; what it reads is handed to `onRead`, which has the frame's
 * view (`MarkdownFrameView`) show it.
 *
 * The note is found as a link finds one (`frameNote`), and the section read as
 * `readFrameContent` reads it. When to look again is the caller's to say,
 * since the caller hears the vault for every frame: `follow` for which file
 * the link names, `read` for what the file holds.
 *
 * A note is the file found and the path it had when it was found: a card is
 * resolved against the path, so the same file at a new path is another note
 * to read. Readings may end out of the order they began in; one overtaken by
 * a later one, or one that ends after `close`, is dropped.
 */

import type { App, TAbstractFile, TFile } from 'obsidian';
import { logError } from '../../log/log';
import { frameTarget, frameTitle, readFrameContent, type FrameContent } from '../../services/data/MarkdownFrames';
import { frameNote } from '../../services/data/MarkdownFrameNotes';
import { splitLines } from '../../services/persistence/FileLines';
import type { TaskViewerSettings } from '../../types';
import { isNote } from '../../utils/NoteLink';

/**
 * What a frame read, with the name its row shows of it. A section of a note
 * comes with the path its cards are resolved against, the note's path when it
 * was found; that the note is not there comes with no path.
 */
export type FrameRead =
    | { reading: FrameContent; title: string; path: string }
    | { reading: { kind: 'no-note' }; title: string; path: null };

/** What a reader is handed of the panel that holds it. */
export interface MarkdownFrameReaderHost {
    app: Pick<App, 'metadataCache' | 'vault'>;
    /** The keys a section's style and mask are read by are settings. */
    settings(): TaskViewerSettings;
}

export class MarkdownFrameReader {
    private frameLink: string;
    /** Whether `follow` was called: before it, the note is not looked for. */
    private following = false;
    /** The note the link names, and the path it had when it was found. */
    private found: { file: TFile; path: string } | null = null;
    /** Counts the readings begun, so that one overtaken by a later one is dropped. */
    private reads = 0;
    private closed = false;

    /**
     * A reader of the frame of `link`, which has looked for nothing yet:
     * `follow` turns it to its note. What it reads goes to `onRead`.
     */
    constructor(
        private readonly host: MarkdownFrameReaderHost,
        link: string,
        private readonly onRead: (read: FrameRead) => void,
    ) {
        this.frameLink = link;
    }

    /** The link the frame shows the section of. */
    get link(): string {
        return this.frameLink;
    }

    /** The note found for the link; null when there is none, or it was not looked for yet. */
    get note(): TFile | null {
        return this.found?.file ?? null;
    }

    /** The name the frame's row shows before anything is read: the last thing its link names. */
    untitled(): string {
        return frameTitle(this.frameLink, { kind: 'no-note' }, null);
    }

    /** The frame's link is `link` now: its note is looked for and read anew, once the reader follows. */
    setLink(link: string): void {
        if (link === this.frameLink) return;
        this.frameLink = link;
        if (this.following) this.turnTo(this.lookUp());
    }

    /**
     * Turn to the note the link names now, and read it, unless it is the
     * note already found, at the path it was found at. Called first once
     * the vault's files are known, and whenever a file made, moved or
     * deleted may have changed which note that is.
     */
    follow(): void {
        if (this.closed) return;
        const file = this.lookUp();
        if (this.following && file === this.note && file?.path === this.found?.path) return;
        this.following = true;
        this.turnTo(file);
    }

    /** Read the note again, and hand on what the link names of it now. */
    async read(): Promise<void> {
        const { found } = this;
        if (!found || this.closed) return;
        const turn = ++this.reads;
        let content: string;
        try {
            content = await this.host.app.vault.cachedRead(found.file);
        } catch (e) {
            logError(`[MarkdownFrame] reading ${found.path} failed: ${e instanceof Error ? e.message : String(e)}`, { notice: false });
            return;
        }
        if (turn !== this.reads) return;
        const reading = readFrameContent(splitLines(content).lines, frameTarget(this.frameLink).subpath, this.host.settings());
        this.onRead({ reading, title: frameTitle(this.frameLink, reading, found.file.basename), path: found.path });
    }

    /**
     * The note found, when it was renamed or moved since it was found and is
     * a note still (its path is where it is now); null otherwise. A note
     * renamed to another extension is not one: the frame does not follow it
     * there.
     */
    movedTo(): TFile | null {
        const { found } = this;
        if (!found || found.file.path === found.path || !isNote(found.file)) return null;
        return found.file;
    }

    /** Whether the note found is `file`. */
    shows(file: TAbstractFile): boolean {
        return this.found?.file === file;
    }

    /** Hand on nothing more: a reading under way, or one begun later, is dropped. */
    close(): void {
        this.closed = true;
        this.reads++;
    }

    private lookUp(): TFile | null {
        return frameNote(this.host.app.metadataCache, this.frameLink);
    }

    /** Take `file` as the frame's note, read anew; null for no note. A reading under way is dropped. */
    private turnTo(file: TFile | null): void {
        this.reads++;
        this.found = file ? { file, path: file.path } : null;
        if (file) {
            void this.read();
        } else if (!this.closed) {
            const reading = { kind: 'no-note' } as const;
            this.onRead({ reading, title: frameTitle(this.frameLink, reading, null), path: null });
        }
    }
}
