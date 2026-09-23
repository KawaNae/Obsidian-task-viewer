/**
 * A bench's files, where every change to a file's bytes is also a change the
 * index hears about — as Obsidian sends `modify` for every write that changed
 * a file, the plugin's own and everyone else's (F6's observation).
 *
 * The index counts those against the writes of its own it is waiting on
 * (`TaskScanner.noteChange`), and a change it cannot account for is an
 * outside one. A bench that changed its files without saying so would leave
 * the count with nothing outside to see, and every test of what an outside
 * change does to identity would pass for the wrong reason.
 *
 * A write of the plugin's own has to file its claim before its bytes land
 * here, as `vault.process` does: the callback files, the write lands, the
 * `modify` follows.
 */
export class NoticedFiles extends Map<string, string> {
    private notice: ((path: string) => void) | null = null;

    /** Start telling `notice` about changes; until then, set is plain. */
    listen(notice: (path: string) => void): this {
        this.notice = notice;
        return this;
    }

    override set(path: string, text: string): this {
        const changed = super.get(path) !== text;
        super.set(path, text);
        if (changed && this.notice) this.notice(path);
        return this;
    }
}
