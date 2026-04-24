import type { Task } from '../../../types';
import { ParserStrategy } from '../strategies/ParserStrategy';
import { isTimerTargetId } from '../../../utils/TimerTargetIdUtils';
import { TaskIdGenerator } from '../../display/TaskIdGenerator';
import { TagExtractor } from '../utils/TagExtractor';
import { TaskLineClassifier } from '../utils/TaskLineClassifier';

/**
 * Parser for plain checkbox lines with no scheduling notation.
 *
 * Picks up `- [ ] content` without any `@` date block. Acts as the last
 * fallback in ParserChain so that AtNotationParser remains authoritative
 * for anything with scheduling. The produced Task has no start/end/due
 * fields and carries parserId='plain'.
 *
 * Scope gating (non-task-bearing files, lines under an ancestor task)
 * happens in TreeTaskExtractor — this parser always accepts checkbox
 * lines it sees. That keeps parsers context-free.
 */
export class PlainTaskParser implements ParserStrategy {
    readonly id = 'plain';
    readonly isReadOnly = false;

    parse(line: string, filePath: string, lineNumber: number): Task | null {
        let lineForParse = line;
        let blockId: string | undefined;
        let timerTargetId: string | undefined;
        const blockIdMatch = lineForParse.match(/\s\^([A-Za-z0-9-]+)\s*$/);
        if (blockIdMatch) {
            blockId = blockIdMatch[1];
            if (isTimerTargetId(blockId)) {
                timerTargetId = blockId;
            }
            lineForParse = lineForParse.slice(0, blockIdMatch.index).trimEnd();
        }

        const classified = TaskLineClassifier.classify(lineForParse);
        if (!classified) {
            return null;
        }

        const content = classified.rawContent.trim();

        return {
            id: TaskIdGenerator.generate(
                this.id,
                filePath,
                TaskIdGenerator.resolveAnchor({
                    parserId: this.id,
                    line: lineNumber,
                    blockId,
                    timerTargetId,
                })
            ),
            file: filePath,
            line: lineNumber,
            content,
            statusChar: classified.statusChar,
            indent: 0,          // set by TaskScanner / TreeTaskExtractor
            childIds: [],
            childLines: [],
            childLineBodyOffsets: [],
            tags: TagExtractor.fromContent(content),
            originalText: line,
            commands: [],
            parserId: this.id,
            blockId,
            timerTargetId,
            properties: {},
        };
    }

    format(task: Task): string {
        const statusChar = task.statusChar || ' ';
        const marker = TaskLineClassifier.extractMarker(task.originalText);
        const blockIdStr = task.blockId ? ` ^${task.blockId}` : '';
        return `${marker} [${statusChar}] ${task.content}${blockIdStr}`;
    }

    isTriggerableStatus(task: Task): boolean {
        return task.statusChar !== ' ';
    }
}
