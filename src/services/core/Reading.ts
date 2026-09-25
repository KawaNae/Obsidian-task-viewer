/**
 * Which reading of a file a name was given in: the index's session and the
 * reading's number among that file's readings.
 *
 * A file's readings are numbered as they are committed, one after another,
 * and a content read again that the last reading already read is not
 * committed, so it takes no number. Two readings of one content — a write of
 * ours that brought the file back to what it was — are two numbers, where the
 * content's key could not tell them apart. The session keeps the numbers of
 * one index from meeting those of the next (a reload starts again from 1).
 *
 * Whether a reading is still what the file holds is the content's key to
 * answer; the index keeps that key beside the number (`TaskScanner`).
 */
export type ReadingId = string;

const READING = /^([0-9a-z]+)\.(\d+)$/;

let sessions = 0;

/** A session no index of this window has had before. */
export function newSession(): string {
    sessions += 1;
    return `${Date.now().toString(36)}${sessions.toString(36)}`;
}

export function readingId(session: string, n: number): ReadingId {
    return `${session}.${n}`;
}

/** What a reading's ID says, or null for a string of another shape. */
export function readReading(id: string): { session: string; n: number } | null {
    const match = id.match(READING);
    return match ? { session: match[1], n: Number(match[2]) } : null;
}
