import { isTvFile, type ParserId, type Task } from '../../types';

const PARSER_IDS: ReadonlySet<ParserId> = new Set(['tv-inline', 'tv-file', 'tasks-plugin', 'day-planner']);

function isParserId(value: string): value is ParserId {
    return PARSER_IDS.has(value as ParserId);
}

export interface ParsedTaskId {
    parserId: string;
    filePath: string;
    anchor: string;
}

export interface AnchorResolutionInput {
    blockId?: string;
    timerTargetId?: string;
    line?: number;
    parserId: ParserId;
}

export interface ParsedSegmentId {
    baseId: string;
    segmentDate: string;
}

const TASK_ID_REGEX = /^([^:]+):(.+):(blk:[^:]+|tid:[^:]+|seq:\d+|ln:\d+|fm-root)$/;
const RUNTIME_ANCHOR_REGEX = /^(seq:\d+|fm-root)$/;
const SEGMENT_ID_REGEX = /^(.*)##seg:(\d{4}-\d{2}-\d{2})$/;

export class TaskIdGenerator {
    static generate(parserId: ParserId, filePath: string, anchor: string): string {
        return `${parserId}:${filePath}:${anchor}`;
    }

    static resolveAnchor(input: AnchorResolutionInput): string {
        const blockId = input.blockId?.trim();
        if (blockId) {
            return `blk:${blockId}`;
        }

        const timerTargetId = input.timerTargetId?.trim();
        if (timerTargetId) {
            return `tid:${timerTargetId}`;
        }

        if (isTvFile(input)) {
            return 'fm-root';
        }

        // Has explicit body line — use it as anchor. Otherwise fall through to ln:0.
        if (typeof input.line === 'number' && input.line >= 0) {
            return `ln:${input.line + 1}`;
        }

        return 'ln:0';
    }

    /**
     * The runtime ID a scan hands out to a task the ledger has not seen.
     *
     * Transitional shape: `seq:<n>` still sits behind the path, so the shape
     * guards and `renameFile` keep working unchanged. The tv-file task keeps its
     * `fm-root` ID and consumes no number — it is on its way out.
     */
    static mintRuntimeId(task: Pick<Task, 'id' | 'parserId' | 'file'>, next: () => number): string {
        if (isTvFile(task)) {
            return task.id;
        }
        return this.generate(task.parserId, task.file, `seq:${next()}`);
    }

    /**
     * Whether `id` is shaped like an ID a scan commits to the store.
     *
     * A positive test on purpose: provisional IDs come in several shapes
     * (`ln:`, `blk:`, `tid:`), and listing them would let a new one slip past.
     */
    static isRuntimeId(id: string): boolean {
        const parsed = this.parse(id);
        return parsed !== null && RUNTIME_ANCHOR_REGEX.test(parsed.anchor);
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

    static renameFile(id: string, oldPath: string, newPath: string): string {
        const segment = this.parseSegmentId(id);
        if (segment) {
            const renamedBase = this.renameFile(segment.baseId, oldPath, newPath);
            return this.makeSegmentId(renamedBase, segment.segmentDate);
        }

        const parsed = this.parse(id);
        if (!parsed || parsed.filePath !== oldPath) {
            return id;
        }

        // parse() returns parserId as a raw string from regex; validate before
        // re-generating so renameFile cannot smuggle an unknown ParserId.
        if (!isParserId(parsed.parserId)) {
            return id;
        }

        return this.generate(parsed.parserId, newPath, parsed.anchor);
    }
}
