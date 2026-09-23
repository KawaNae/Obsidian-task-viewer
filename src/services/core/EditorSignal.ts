/**
 * How long after the last hand in an editor its signal still speaks for the
 * next change to the file. Past it, the change the editor was going to save
 * has been saved and read, and a later one is not the hand's — without a
 * bound, a signal no save consumed would fire the next sync's completion.
 * Obsidian saves an editor's buffer a short debounce after the last input;
 * this is that delay with room to spare (measured on Dev, see F6's report).
 */
export const EDITOR_SIGNAL_LIFETIME_MS = 10_000;

/**
 * The user's hand in an editor: that someone typed into, or clicked a
 * checkbox of, a file's editor since a scan last asked.
 *
 * One of the two answers to whether a completion may fire (`structure.md`,
 * 「自己書き込みの判定と発火の可否」). A completion a write of ours made is
 * answered by the write's own origin (`WriteClaims.writerOf`). What no write
 * of ours made came from an editor or from outside — a sync, another device —
 * and the content cannot say which. This says the editor's side.
 *
 * Per path, because an editor holds a file. A scan takes it once, for every
 * row it decides without a write of ours behind it (see `TaskScanner`), so one
 * hand edit that completes several rows fires them all.
 */
export class EditorSignal {
    /** When a hand was last in each file's editor. */
    private readonly marks = new Map<string, number>();

    constructor(private readonly now: () => number = () => Date.now()) { }

    /** Someone worked in the editor of this file. */
    mark(path: string): void {
        this.marks.set(path, this.now());
    }

    /**
     * Whether someone worked in the editor of this file since the last take,
     * recently enough to speak for what is read now; and clear it.
     */
    take(path: string): boolean {
        const at = this.marks.get(path);
        this.marks.delete(path);
        return at !== undefined && this.now() - at <= EDITOR_SIGNAL_LIFETIME_MS;
    }

    /** The file is gone or renamed: its editor's word no longer applies. */
    forget(path: string): void {
        this.marks.delete(path);
    }
}
