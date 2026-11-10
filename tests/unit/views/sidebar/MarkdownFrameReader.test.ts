import { describe, expect, it } from 'vitest';
import type { TFile } from 'obsidian';
import { DEFAULT_SETTINGS } from '../../../../src/types';
import { MarkdownFrameReader, type FrameRead, type MarkdownFrameReaderHost } from '../../../../src/views/sidebar/MarkdownFrameReader';
import { makeFile } from '../../helpers/vaultSession';

/**
 * What one markdown frame reads, without an element: the note its link
 * names, through a metadata cache that resolves a link's path to a file of
 * the test's, and the note's text, through a `cachedRead` the test ends
 * itself, in the order it chooses.
 */
function readerOver(link: string) {
    /** The files a link's path resolves to, by the path. */
    const names = new Map<string, TFile>();
    /** The readings begun and not ended yet, oldest first. */
    const pending: { file: TFile; end: (text: string) => Promise<void> }[] = [];
    const host: MarkdownFrameReaderHost = {
        app: {
            metadataCache: {
                getFirstLinkpathDest: (path: string) => names.get(path) ?? null,
            },
            vault: {
                cachedRead: (file: TFile) => new Promise<string>((resolve) => {
                    pending.push({
                        file,
                        // Ending a reading lets the reader's continuation run.
                        end: async (text) => { resolve(text); await Promise.resolve(); await Promise.resolve(); },
                    });
                }),
            },
        } as unknown as MarkdownFrameReaderHost['app'],
        settings: () => DEFAULT_SETTINGS,
    };
    const reads: FrameRead[] = [];
    const reader = new MarkdownFrameReader(host, link, read => reads.push(read));
    return {
        reader,
        reads,
        pending,
        /** Have `path` resolve to a new note at `filePath`. */
        name: (path: string, filePath: string) => {
            const file = makeFile(filePath);
            names.set(path, file);
            return file;
        },
    };
}

const MEMO_NOTE = ['# Memo', 'first', '# Other', 'second'].join('\n');

describe('the reader of a markdown frame', () => {
    it('looks for nothing before follow, and its row is named by the last thing its link names', () => {
        const frame = readerOver('Folder/Note#Memo');
        frame.name('Folder/Note', 'Folder/Note.md');
        expect(frame.reader.untitled()).toBe('Memo');
        expect(frame.reader.note).toBeNull();
        expect(frame.pending).toHaveLength(0);
    });

    it('finds the note at follow, reads it and hands on the section, its name and the path it was found at', async () => {
        const frame = readerOver('Folder/Note#Memo');
        const note = frame.name('Folder/Note', 'Folder/Note.md');
        frame.reader.follow();
        expect(frame.reader.note).toBe(note);
        expect(frame.reader.shows(note)).toBe(true);
        expect(frame.pending.map(p => p.file)).toEqual([note]);

        await frame.pending[0].end(MEMO_NOTE);
        expect(frame.reads).toHaveLength(1);
        expect(frame.reads[0]).toMatchObject({
            reading: { kind: 'heading', title: 'Memo', markdown: 'first' },
            title: 'Memo',
            path: 'Folder/Note.md',
        });
    });

    it('turns to the note again only when the link names another file, or the file is at another path', () => {
        const frame = readerOver('Note');
        const note = frame.name('Note', 'Note.md');
        frame.reader.follow();
        frame.reader.follow();
        expect(frame.pending).toHaveLength(1);

        note.path = 'Moved/Note.md';
        frame.reader.follow();
        expect(frame.pending).toHaveLength(2);
    });

    it('tells the note it found once it moved, at its new path: none while it is where it was found, none once it is no note', () => {
        const frame = readerOver('Note#Memo');
        expect(frame.reader.movedTo()).toBeNull();
        const note = frame.name('Note', 'Note.md');
        frame.reader.follow();
        expect(frame.reader.movedTo()).toBeNull();

        note.path = 'Moved/Note.md';
        expect(frame.reader.movedTo()?.path).toBe('Moved/Note.md');

        note.path = 'Moved/Note.txt';
        note.extension = 'txt';
        expect(frame.reader.movedTo()).toBeNull();
    });

    it('drops a reading that ends after a later one began', async () => {
        const frame = readerOver('Folder/Note#Memo');
        frame.name('Folder/Note', 'Folder/Note.md');
        frame.reader.follow();
        void frame.reader.read();
        const [older, newer] = frame.pending;

        await newer.end(['# Memo', 'new'].join('\n'));
        await older.end(['# Memo', 'old'].join('\n'));
        expect(frame.reads.map(r => 'markdown' in r.reading ? r.reading.markdown : null)).toEqual(['new']);
    });

    it('hands on nothing after close, for a reading that ends later or one asked for after it', async () => {
        const frame = readerOver('Folder/Note#Memo');
        frame.name('Folder/Note', 'Folder/Note.md');
        frame.reader.follow();
        frame.reader.close();
        await frame.pending[0].end(MEMO_NOTE);

        void frame.reader.read();
        frame.reader.follow();
        frame.reader.setLink('Gone#Memo');
        expect(frame.pending).toHaveLength(1);
        expect(frame.reads).toEqual([]);
    });

    it('reads anew when its link is set to another note, and drops the reading of the one before', async () => {
        const frame = readerOver('Folder/Note#Memo');
        frame.name('Folder/Note', 'Folder/Note.md');
        const renamed = frame.name('Other/Renamed', 'Other/Renamed.md');
        frame.reader.follow();

        frame.reader.setLink('Other/Renamed#Memo');
        expect(frame.reader.link).toBe('Other/Renamed#Memo');
        expect(frame.reader.note).toBe(renamed);
        const [before, after] = frame.pending;
        expect(after.file).toBe(renamed);

        await before.end(MEMO_NOTE);
        await after.end(MEMO_NOTE);
        expect(frame.reads).toHaveLength(1);
        expect(frame.reads[0].path).toBe('Other/Renamed.md');
    });

    it('takes a link set before follow, and looks for nothing until follow', () => {
        const frame = readerOver('Folder/Note#Memo');
        frame.name('Other/Renamed', 'Other/Renamed.md');
        frame.reader.setLink('Other/Renamed#Memo');
        expect(frame.pending).toHaveLength(0);
        frame.reader.follow();
        expect(frame.pending).toHaveLength(1);
    });

    it('says at once that the note is not there when its link names none, with no path', () => {
        const frame = readerOver('Folder/Missing#Memo');
        frame.reader.follow();
        expect(frame.pending).toHaveLength(0);
        expect(frame.reader.note).toBeNull();
        expect(frame.reads).toEqual([{ reading: { kind: 'no-note' }, title: 'Memo', path: null }]);
    });

    it('says the note is gone once its link names no file, and drops the reading under way', async () => {
        const frame = readerOver('Folder/Note#Memo');
        frame.name('Folder/Note', 'Folder/Note.md');
        frame.reader.follow();
        frame.reader.setLink('Folder/Missing#Memo');
        await frame.pending[0].end(MEMO_NOTE);
        expect(frame.reads).toEqual([{ reading: { kind: 'no-note' }, title: 'Memo', path: null }]);
    });

    it('says the section is not there when the note has no heading its link names', async () => {
        const frame = readerOver('Folder/Note#Nope');
        frame.name('Folder/Note', 'Folder/Note.md');
        frame.reader.follow();
        await frame.pending[0].end(MEMO_NOTE);
        expect(frame.reads).toEqual([{ reading: { kind: 'no-heading' }, title: 'Nope', path: 'Folder/Note.md' }]);
    });
});
