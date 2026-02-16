export interface ParsedTaskId {
    parserId: string;
    filePath: string;
    anchor: string;
}

export interface AnchorResolutionInput {
    blockId?: string;
    timerTargetId?: string;
    line?: number;
    parserId: string;
}

export interface ParsedSegmentId {
    baseId: string;
    segmentDate: string;
}

const TASK_ID_REGEX = /^([^:]+):(.+):(blk:[^:]+|tid:[^:]+|ln:\d+|fm-root)$/;
const SEGMENT_ID_REGEX = /^(.*)##seg:(\d{4}-\d{2}-\d{2})$/;

export class TaskIdGenerator {
    static generate(parserId: string, filePath: string, anchor: string): string {
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

        if (input.parserId === 'frontmatter') {
            return 'fm-root';
        }

        if (typeof input.line === 'number' && input.line >= 0) {
            return `ln:${input.line + 1}`;
        }

        return 'ln:0';
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

        return this.generate(parsed.parserId, newPath, parsed.anchor);
    }
}
