import type { ParserId, Task } from '../../../types';

/**
 * The identifying material of a task, with the line number deliberately left out.
 *
 * This is the whole reason the ledger exists: the old ID carried `ln:<line>`, so
 * inserting one line above a task made it a different task. What survives an edit
 * is the text and the dates, not the position — so those are what the matcher
 * compares: blockId → originalText → content + dates. The write layer does not
 * keep a ladder of its own; it asks this one (`TaskScanner.locate`), so a
 * write and the scan after it cannot disagree about which line a name is on.
 */
export interface Fingerprint {
    parserId: ParserId;
    /** `^id` when the user wrote one. Absent (not empty) when there is none. */
    blockId?: string;
    originalText: string;
    contentKey: string;
    dateKey: string;
}

/** The only place a Task is turned into a Fingerprint. */
export function fingerprintOf(task: Task): Fingerprint {
    const fingerprint: Fingerprint = {
        parserId: task.parserId,
        originalText: task.originalText,
        contentKey: task.content.trim(),
        dateKey: dateKeyOf(task),
    };

    // A blank `blockId` is no anchor at all; leaving the key absent keeps the
    // matcher's first rung from bucketing every anchorless task together.
    const blockId = task.blockId?.trim();
    if (blockId) {
        fingerprint.blockId = blockId;
    }

    return fingerprint;
}

function dateKeyOf(task: Task): string {
    return [task.startDate, task.startTime, task.endDate, task.endTime, task.due]
        .map(value => value ?? '')
        .join('|');
}
