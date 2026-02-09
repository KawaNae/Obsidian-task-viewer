import { Task } from '../../types';
import { DateUtils } from '../../utils/DateUtils';

/**
 * View-only task segment used by timeline/schedule rendering.
 */
export interface RenderableTask extends Task {
    id: string;
    originalTaskId: string;
    isSplit: boolean;
    splitSegment?: 'before' | 'after';
    _isReadOnly?: boolean;
}

/**
 * Returns true when a task crosses the visual day boundary and should be split.
 */
export function shouldSplitTask(task: Task, startHour: number): boolean {
    if (!task.startDate || !task.endDate || !task.startTime || !task.endTime) {
        return false;
    }

    const visualStartDay = DateUtils.getVisualStartDate(task.startDate, task.startTime, startHour);

    let visualEndDay = task.endDate;
    const [endH, endM] = task.endTime.split(':').map(Number);
    if (endH < startHour || (endH === startHour && endM === 0)) {
        visualEndDay = DateUtils.addDays(task.endDate, -1);
    }

    if (visualStartDay !== visualEndDay) {
        return true;
    }

    const startDateTime = new Date(`${task.startDate}T${task.startTime}`);
    const endDateTime = new Date(`${task.endDate}T${task.endTime}`);
    if (endDateTime < startDateTime) return false;

    const durationHours = (endDateTime.getTime() - startDateTime.getTime()) / (1000 * 60 * 60);
    if (durationHours >= 24) return false;

    return false;
}

/**
 * Splits a task into two renderable segments at the visual day boundary.
 */
export function splitTaskAtBoundary(task: Task, startHour: number): [RenderableTask, RenderableTask] {
    if (!task.startDate || !task.endDate || !task.startTime || !task.endTime) {
        throw new Error('Task must have start and end date/time to split');
    }

    let boundaryDate: string;
    const boundaryTime = `${startHour.toString().padStart(2, '0')}:00`;

    if (task.startDate === task.endDate) {
        boundaryDate = task.startDate;
    } else {
        const startDateObj = new Date(task.startDate);
        const boundaryDateObj = new Date(startDateObj);
        boundaryDateObj.setDate(boundaryDateObj.getDate() + 1);
        boundaryDate = boundaryDateObj.toISOString().split('T')[0];
    }

    const beforeSegment: RenderableTask = {
        ...task,
        id: `${task.id}:before`,
        originalTaskId: task.id,
        isSplit: true,
        splitSegment: 'before',
        endDate: boundaryDate,
        endTime: boundaryTime,
    };

    const afterSegment: RenderableTask = {
        ...task,
        id: `${task.id}:after`,
        originalTaskId: task.id,
        isSplit: true,
        splitSegment: 'after',
        startDate: boundaryDate,
        startTime: boundaryTime,
    };

    return [beforeSegment, afterSegment];
}