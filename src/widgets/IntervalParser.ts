import { Task } from '../types';
import { TaskIndex } from '../services/core/TaskIndex';
import { IntervalGroup, IntervalSegment } from './TimerInstance';

type ParsedDuration = {
    seconds: number;
    label: string;
};

export class IntervalParser {
    private static readonly DURATION_REGEX = /^(\d+)\s*(h|m|min|s|sec)(?:\s*(\d+)\s*(m|min|s|sec))?/i;
    private static readonly GROUP_HEADER_REGEX = /^-\s*\[[^\]]\]\s*x(\d+)\b\s*(.*)$/i;
    private static readonly CHECKBOX_LINE_REGEX = /^-\s*\[[^\]]\]\s*(.*)$/;
    private static readonly LIST_ITEM_PREFIX_REGEX = /^-\s*/;

    static hasIntervalSegments(task: Task, taskIndex: TaskIndex): boolean {
        return this.parseIntervalGroups(task, taskIndex).length > 0;
    }

    static parseIntervalGroups(task: Task, taskIndex: TaskIndex): IntervalGroup[] {
        const childLines = this.collectChildLines(task, taskIndex);
        if (childLines.length === 0) {
            return [];
        }

        const groups: IntervalGroup[] = [];
        const linesWithIndent = childLines.map((line) => ({
            raw: line,
            indent: this.getIndentWidth(line),
            trimmed: line.trim(),
        }));

        for (let i = 0; i < linesWithIndent.length; i++) {
            const current = linesWithIndent[i];
            if (!current.trimmed) {
                continue;
            }

            const groupMatch = current.trimmed.match(this.GROUP_HEADER_REGEX);
            if (groupMatch) {
                const repeatCount = Math.max(1, Number(groupMatch[1]) || 1);
                const groupLabel = groupMatch[2]?.trim() || `x${repeatCount}`;
                const childIndent = this.detectImmediateChildIndent(linesWithIndent, i, current.indent);
                if (childIndent === null) {
                    continue;
                }

                const segments: IntervalSegment[] = [];
                for (let j = i + 1; j < linesWithIndent.length; j++) {
                    const next = linesWithIndent[j];
                    if (next.trimmed === '') {
                        continue;
                    }
                    if (next.indent <= current.indent) {
                        break;
                    }
                    if (next.indent !== childIndent) {
                        continue;
                    }
                    const parsed = this.parseSegmentLine(next.trimmed);
                    if (parsed) {
                        segments.push(parsed);
                    }
                }

                if (segments.length > 0) {
                    groups.push({
                        repeatCount,
                        segments: segments.map((segment, index) => ({
                            ...segment,
                            label: segment.label || `${groupLabel} ${index + 1}`,
                        })),
                    });
                }
                continue;
            }

            if (current.indent !== 0) {
                continue;
            }

            const parsedSingle = this.parseSegmentLine(current.trimmed);
            if (!parsedSingle) {
                continue;
            }

            groups.push({
                repeatCount: 1,
                segments: [parsedSingle],
            });
        }

        return groups;
    }

    static parseDuration(text: string): number | null {
        const parsed = this.parseDurationWithLabel(text);
        return parsed ? parsed.seconds : null;
    }

    private static parseSegmentLine(line: string): IntervalSegment | null {
        const checkboxMatch = line.match(this.CHECKBOX_LINE_REGEX);
        if (checkboxMatch) {
            const parsed = this.parseDurationWithLabel(checkboxMatch[1] || '');
            if (!parsed) {
                return null;
            }
            return {
                durationSeconds: parsed.seconds,
                type: 'work',
                label: parsed.label || 'Work',
            };
        }

        const noPrefix = line.replace(this.LIST_ITEM_PREFIX_REGEX, '');
        const parsed = this.parseDurationWithLabel(noPrefix);
        if (!parsed) {
            return null;
        }
        return {
            durationSeconds: parsed.seconds,
            type: 'break',
            label: parsed.label || 'Break',
        };
    }

    private static parseDurationWithLabel(text: string): ParsedDuration | null {
        const input = text.trim();
        if (!input) {
            return null;
        }

        const match = input.match(this.DURATION_REGEX);
        if (!match) {
            return null;
        }

        const firstValue = Number(match[1]);
        const firstUnit = match[2];
        const secondValue = match[3] ? Number(match[3]) : null;
        const secondUnit = match[4] || null;

        if (!Number.isFinite(firstValue) || firstValue <= 0) {
            return null;
        }

        let seconds = this.unitToSeconds(firstValue, firstUnit);
        if (secondValue !== null && secondUnit && Number.isFinite(secondValue) && secondValue >= 0) {
            seconds += this.unitToSeconds(secondValue, secondUnit);
        }

        if (seconds <= 0) {
            return null;
        }

        const consumed = match[0];
        const label = input.slice(consumed.length).trim();
        return { seconds, label };
    }

    private static unitToSeconds(value: number, unit: string): number {
        const normalized = unit.toLowerCase();
        if (normalized === 'h') return value * 3600;
        if (normalized === 'm' || normalized === 'min') return value * 60;
        return value;
    }

    private static detectImmediateChildIndent(
        lines: Array<{ raw: string; indent: number; trimmed: string }>,
        startIndex: number,
        parentIndent: number
    ): number | null {
        for (let i = startIndex + 1; i < lines.length; i++) {
            const line = lines[i];
            if (!line.trimmed) {
                continue;
            }
            if (line.indent <= parentIndent) {
                return null;
            }
            return line.indent;
        }
        return null;
    }

    private static getIndentWidth(line: string): number {
        const match = line.match(/^(\s*)/);
        if (!match) {
            return 0;
        }
        return match[1].replace(/\t/g, '    ').length;
    }

    private static collectChildLines(task: Task, taskIndex: TaskIndex): string[] {
        const lines: string[] = [];

        for (const line of task.childLines || []) {
            if (line.trim().length > 0) {
                lines.push(line);
            }
        }

        if (lines.length > 0) {
            return lines;
        }

        // Fallback: build from direct child tasks when childLines are unavailable.
        for (const childId of task.childIds || []) {
            const child = taskIndex.getTask(childId);
            if (!child) {
                continue;
            }
            if (child.originalText.trim().length === 0) {
                continue;
            }
            lines.push(child.originalText.trimStart());
        }

        return lines;
    }
}
