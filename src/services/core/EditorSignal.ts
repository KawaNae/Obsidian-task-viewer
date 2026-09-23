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
    private readonly marks = new Set<string>();

    /** Someone worked in the editor of this file. */
    mark(path: string): void {
        this.marks.add(path);
    }

    /** Whether someone worked in the editor of this file since the last take; and clear it. */
    take(path: string): boolean {
        return this.marks.delete(path);
    }

    /** The file is gone or renamed: its editor's word no longer applies. */
    forget(path: string): void {
        this.marks.delete(path);
    }
}
