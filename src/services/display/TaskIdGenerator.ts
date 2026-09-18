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

export interface ParsedSegmentId {
    baseId: string;
    segmentDate: string;
}

// `blk:`, `tid:` and `ln:` are no longer minted. They stay readable because
// timers persisted before the ledger still carry them, and the restore guard
// (TimerPersistence.fromPersistedTimer) drops any ID `parse` rejects. `prov:` is
// left out on purpose: a provisional ID that leaked should fail to parse.
const TASK_ID_REGEX = /^([^:]+):(.+):(blk:[^:]+|tid:[^:]+|seq:\d+|ln:\d+|fm-root)$/;
const RUNTIME_ANCHOR_REGEX = /^(seq:\d+|fm-root)$/;
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
     * scan — `applyIdentity` swaps it for a runtime ID before anything else reads
     * it — so the line number cannot leak into what consumers hold.
     */
    static provisionalId(parserId: ParserId, filePath: string, line: number): string {
        return this.generate(parserId, filePath, `prov:${line}`);
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
     * A positive test on purpose: `prov:` is not the only shape that must stay
     * out of the store — the legacy `ln:`, `blk:` and `tid:` still parse — and
     * listing the bad shapes would let a new one slip past.
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
