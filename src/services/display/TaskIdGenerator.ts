import type { ParserId } from '../../types';
import type { ContentKey } from '../core/ContentKey';

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
const TASK_ID_REGEX = /^([^:]+):(.+):(n:\d+:\d+:\d+:[0-9a-f]{16}|blk:[^:]+|tid:[^:]+|seq:\d+|ln:\d+|fm-root)$/;
const NAME_ANCHOR_REGEX = /^n:(\d+):(\d+:\d+:[0-9a-f]{16})$/;
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
     * The name a reading gives the row on `line` of the content `content` of
     * `filePath`: the path, the content's key and the line.
     *
     * One reading holds one row per line, so a name picks one row of it. The
     * same content read again gives every row the same name, so a `modify`
     * that changed nothing, or a reload, leaves the names as they were. Any
     * change to the file changes every name in it: a name is never carried to
     * another reading, where the line it points at could hold another row.
     */
    static nameOf(parserId: ParserId, filePath: string, line: number, content: ContentKey): string {
        return this.generate(parserId, filePath, `n:${line}:${content}`);
    }

    /** What a name says (`nameOf`), or null for an ID of any other shape. */
    static readName(id: string): { parserId: string; filePath: string; line: number; content: ContentKey } | null {
        const parsed = this.parse(id);
        if (!parsed) return null;
        const match = parsed.anchor.match(NAME_ANCHOR_REGEX);
        if (!match) return null;
        return { parserId: parsed.parserId, filePath: parsed.filePath, line: Number(match[1]), content: match[2] };
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

