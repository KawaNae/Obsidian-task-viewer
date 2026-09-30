import { DateUtils } from '../../utils/DateUtils';

/**
 * The IDs of the segments a row is split into at the day boundary: a key
 * within the display, `<row name>##seg:YYYY-MM-DD`. A segment's row is
 * `DisplayTask.originalTaskId` (`getOriginalTaskId`); the write side and the
 * index know nothing of segments, and take the row's name.
 */

export interface ParsedSegmentId {
    baseId: string;
    segmentDate: string;
}

const SEGMENT_ID_REGEX = new RegExp(String.raw`^(.*)##seg:(${DateUtils.DATE_PATTERN})$`);

export function makeSegmentId(baseId: string, segmentDate: string): string {
    return `${baseId}##seg:${segmentDate}`;
}

export function parseSegmentId(id: string): ParsedSegmentId | null {
    const match = id.match(SEGMENT_ID_REGEX);
    if (!match) return null;
    return { baseId: match[1], segmentDate: match[2] };
}

/**
 * `id` with the ID of its row put through `map`: a segment of a row split
 * at the day boundary keeps its suffix after what `map` answers for its
 * row; undefined when `map` answers undefined. The one place a segment's
 * ID is taken apart to answer for its row's.
 */
export function mapRow<R extends string | undefined>(id: string, map: (rowId: string) => R): R {
    const segment = parseSegmentId(id);
    if (!segment) return map(id);
    const row = map(segment.baseId);
    return (row === undefined ? row : makeSegmentId(row, segment.segmentDate)) as R;
}
