import { DateUtils } from '../../utils/DateUtils';
import type { ParserId } from '../../types';
import { READING_ID_SOURCE, type ReadingId } from '../core/Reading';

export interface ParsedTaskId {
    parserId: string;
    filePath: string;
    anchor: string;
}

export interface ParsedSegmentId {
    baseId: string;
    segmentDate: string;
}

// Only a name (`nameOf`) parses. `prov:` is left out on purpose: a row read
// outside the index (`provisionalId`) is never taken for a reading's.
const TASK_ID_REGEX = new RegExp(String.raw`^([^:]+):(.+):(n:${READING_ID_SOURCE}:\d+)$`);
const NAME_ANCHOR_REGEX = new RegExp(String.raw`^n:(${READING_ID_SOURCE}):(\d+)$`);
const SEGMENT_ID_REGEX = new RegExp(String.raw`^(.*)##seg:(${DateUtils.DATE_PATTERN})$`);

export class TaskIdGenerator {
    static generate(parserId: ParserId, filePath: string, anchor: string): string {
        return `${parserId}:${filePath}:${anchor}`;
    }

    /**
     * The name of a row read outside the index (`namesOutsideIndex`): a fire
     * planned from the lines a write holds, a send's preview.
     *
     * Line-based on purpose: one line yields at most one task, so this is unique
     * within a file even when two lines share a `^blockId`. It never reaches
     * the store, and `readName` refuses it.
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

    /**
     * `id` with the ID of its row put through `map`: a segment of a row split
     * at the day boundary keeps its suffix after what `map` answers for its
     * row; undefined when `map` answers undefined. The one place a segment's
     * ID is taken apart to answer for its row's.
     */
    static mapRow<R extends string | undefined>(id: string, map: (rowId: string) => R): R {
        const segment = this.parseSegmentId(id);
        if (!segment) return map(id);
        const row = map(segment.baseId);
        return (row === undefined ? row : this.makeSegmentId(row, segment.segmentDate)) as R;
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

