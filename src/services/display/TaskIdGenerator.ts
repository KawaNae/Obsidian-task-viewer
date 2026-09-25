import type { ParserId } from '../../types';
import type { ReadingId } from '../core/Reading';

export interface ParsedTaskId {
    parserId: string;
    filePath: string;
    anchor: string;
}

export interface ParsedSegmentId {
    baseId: string;
    segmentDate: string;
}

// `seq:`, `blk:`, `tid:`, `ln:` and `fm-root` are no longer minted. They stay
// readable because timers persisted by earlier versions still carry them, and
// the restore guard (TimerPersistence.fromPersistedTimer) drops any ID `parse`
// rejects. `prov:` is left out on purpose: a provisional ID that leaked should
// fail to parse.
const TASK_ID_REGEX = /^([^:]+):(.+):(n:[0-9a-z]+\.\d+:\d+|blk:[^:]+|tid:[^:]+|seq:\d+|ln:\d+|fm-root)$/;
const NAME_ANCHOR_REGEX = /^n:([0-9a-z]+\.\d+):(\d+)$/;
const SEGMENT_ID_REGEX = /^(.*)##seg:(\d{4}-\d{2}-\d{2})$/;

export class TaskIdGenerator {
    static generate(parserId: ParserId, filePath: string, anchor: string): string {
        return `${parserId}:${filePath}:${anchor}`;
    }

    /**
     * The ID a parser gives a task before the scan has matched it.
     *
     * Line-based on purpose: one line yields at most one task, so this is unique
     * within a file even when two lines share a `^blockId`. It never outlives the
     * scan — the scan swaps it for the row's name (`nameOf`) before anything
     * else reads it.
     */
    static provisionalId(parserId: ParserId, filePath: string, line: number): string {
        return this.generate(parserId, filePath, `prov:${line}`);
    }

    /**
     * The name reading `reading` of `filePath` gives the row on `line`: which
     * reading, and which line of it.
     *
     * One reading holds one row per line, so a name picks one row of it, and
     * no two readings share a number (`ReadingId`), so no name is given
     * twice — not even when a write of ours brings the file back to a content
     * it had. A content read again that the last reading read takes no new
     * number, so a `modify` that changed nothing leaves the names as they
     * were. Any other reading of the file gives every row in it a new name: a
     * name is never carried to another reading, where the line it points at
     * could hold another row.
     */
    static nameOf(parserId: ParserId, filePath: string, line: number, reading: ReadingId): string {
        return this.generate(parserId, filePath, `n:${reading}:${line}`);
    }

    /** What a name says (`nameOf`), or null for an ID of any other shape. */
    static readName(id: string): { parserId: string; filePath: string; reading: ReadingId; line: number } | null {
        const parsed = this.parse(id);
        if (!parsed) return null;
        const match = parsed.anchor.match(NAME_ANCHOR_REGEX);
        if (!match) return null;
        return { parserId: parsed.parserId, filePath: parsed.filePath, reading: match[1], line: Number(match[2]) };
    }

    static parse(id: string): ParsedTaskId | null {
        const match = id.match(TASK_ID_REGEX);
        if (!match) {
            return null;
        }

        return {
            parserId: match[1],
            filePath: match[2],
            anchor: match[3],
        };
    }

    static makeSegmentId(baseId: string, segmentDate: string): string {
        return `${baseId}##seg:${segmentDate}`;
    }

    static parseSegmentId(id: string): ParsedSegmentId | null {
        const match = id.match(SEGMENT_ID_REGEX);
        if (!match) {
            return null;
        }

        return {
            baseId: match[1],
            segmentDate: match[2],
        };
    }
}

