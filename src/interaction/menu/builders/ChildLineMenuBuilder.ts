import { App } from 'obsidian';
import { TaskWriteService } from '../../../services/data/TaskWriteService';
import { CheckboxMenuBuilder, type CheckboxLineOps, type CreateTvFileCallback } from './CheckboxMenuBuilder';
import TaskViewerPlugin from '../../../main';
import type { Task, ChildLine } from '../../../types';
import type { CreateTaskResult } from '../../../modals/CreateTaskModal';

/**
 * Menu builder for plain checkbox child lines on task cards.
 * Delegates menu construction to CheckboxMenuBuilder,
 * providing TaskWriteService-based line operations.
 */
export class ChildLineMenuBuilder {
    private checkboxMenuBuilder: CheckboxMenuBuilder;

    constructor(
        private app: App,
        private writeService: TaskWriteService,
        private plugin: TaskViewerPlugin
    ) {
        const onCreateTvFile: CreateTvFileCallback = async (result, statusChar) => {
            return this.createTvFile(result, statusChar);
        };

        this.checkboxMenuBuilder = new CheckboxMenuBuilder(
            app,
            () => plugin.settings.startHour,
            onCreateTvFile
        );
    }

    showMenu(parentTask: Task, line: ChildLine, bodyLine: number, x: number, y: number): void {
        if (bodyLine < 0) return;
        const settings = this.plugin.settings;

        const ops: CheckboxLineOps = {
            updateLine: (content) => this.writeService.updateChildLine(parentTask.id, bodyLine, content),
            insertLineAfter: (content) => this.writeService.insertChildLineAfter(parentTask.id, bodyLine, content),
            deleteLine: () => this.writeService.deleteChildLine(parentTask.id, bodyLine),
        };

        this.plugin.menuPresenter.present((menu) => {
            this.checkboxMenuBuilder.addFullMenu(menu, line.text, settings, ops, parentTask.file);
        }, { kind: 'position', x, y });
    }

    private async createTvFile(result: CreateTaskResult, statusChar: string): Promise<string> {
        return this.writeService.createTvFileFromData({
            content: result.content,
            statusChar,
            startDate: result.startDate,
            startTime: result.startTime,
            endDate: result.endDate || (result.endTime && result.startDate ? result.startDate : undefined),
            endTime: result.endTime,
            due: result.due,
        });
    }
}
