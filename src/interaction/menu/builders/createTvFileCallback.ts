import type { TaskWriteService } from '../../../services/data/TaskWriteService';
import type { CreateTvFileCallback } from './CheckboxMenuBuilder';

/**
 * The one way a checkbox line becomes a tv-file.
 *
 * `CheckboxMenuBuilder` takes this as a callback so it stays ignorant of the
 * write layer, and for a while both of its callers wrote the callback out by
 * hand. The two copies agreed on the interesting part — an end time with no
 * end date means the task ends on the day it started — and disagreed on the
 * boring one: one went through `TaskWriteService`, the other reached past it
 * to `TaskRepository.createTvFile`. Reaching past it skips the notify that
 * `TaskIndex` wraps around every write, so that one path was left depending
 * on the vault's own create event to refresh the views.
 *
 * There is one implementation now, and it goes through the write service.
 */
export function createTvFileCallback(writeService: TaskWriteService): CreateTvFileCallback {
    return (result, statusChar) =>
        writeService.createTvFileFromData({
            content: result.content,
            statusChar,
            startDate: result.startDate,
            startTime: result.startTime,
            // An end time with no end date ends on the day the task started.
            endDate: result.endDate || (result.endTime && result.startDate ? result.startDate : undefined),
            endTime: result.endTime,
            due: result.due,
        });
}
