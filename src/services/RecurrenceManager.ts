import { Task } from '../types';
import { TaskRepository } from './TaskRepository';
import { RecurrenceUtils } from '../utils/RecurrenceUtils';
import { DateUtils } from '../utils/DateUtils';
import { TaskParser } from './TaskParser';

export class RecurrenceManager {
    private repository: TaskRepository;

    constructor(repository: TaskRepository) {
        this.repository = repository;
    }

    async handleTaskCompletion(task: Task): Promise<void> {
        if (!task.recurrence || task.status !== 'done') {
            return;
        }

        console.log(`[RecurrenceManager] Handling recurrence for ${task.id}`);

        const nextTask = this.calculateNextTask(task);
        const nextContent = TaskParser.format(nextTask);

        // Delegate to repository
        await this.repository.insertRecurrenceForTask(task, nextContent.trim());
    }

    private calculateNextTask(task: Task): Task {
        // Base Date Logic
        let baseDateObj: Date;
        if (task.date) {
            const [y, m, d] = task.date.split('-').map(Number);
            baseDateObj = new Date(y, m - 1, d);
        } else {
            baseDateObj = new Date();
            baseDateObj.setHours(0, 0, 0, 0);
        }

        const nextDateObj = RecurrenceUtils.calculateNextDate(baseDateObj, task.recurrence!);
        const nextDateStr = DateUtils.getLocalDateString(nextDateObj);

        // Reset status to todo
        return {
            ...task,
            id: '',
            status: 'todo',
            statusChar: ' ',
            date: nextDateStr,
            originalText: '',
            children: []
        };
    }
}
