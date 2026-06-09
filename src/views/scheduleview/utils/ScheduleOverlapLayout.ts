import type { ClusteredTaskAssignment, TimedDisplayTask } from '../ScheduleTypes';
import { buildOverlapClusters } from '../../sharedLogic/OverlapClusters';

export class ScheduleOverlapLayout {
    /** start 昇順 → end 降順 → file → line の安定順序（クラスタ検出と列割り当てで共用） */
    private static compareTasks(a: TimedDisplayTask, b: TimedDisplayTask): number {
        if (a.visualStartMinute !== b.visualStartMinute) {
            return a.visualStartMinute - b.visualStartMinute;
        }
        if (a.visualEndMinute !== b.visualEndMinute) {
            return b.visualEndMinute - a.visualEndMinute;
        }
        const fileDiff = a.file.localeCompare(b.file);
        if (fileDiff !== 0) return fileDiff;
        return a.line - b.line;
    }

    buildOverlapClusters(tasks: TimedDisplayTask[]): TimedDisplayTask[][] {
        return buildOverlapClusters(
            tasks,
            ScheduleOverlapLayout.compareTasks,
            t => t.visualStartMinute,
            t => t.visualEndMinute,
        );
    }

    assignClusterColumns(cluster: TimedDisplayTask[]): ClusteredTaskAssignment[] {
        const sorted = cluster.slice().sort(ScheduleOverlapLayout.compareTasks);

        const columnEndMinutes: number[] = [];
        const assigned: Array<{ task: TimedDisplayTask; column: number }> = [];

        for (const task of sorted) {
            let column = -1;
            for (let i = 0; i < columnEndMinutes.length; i++) {
                if (task.visualStartMinute >= columnEndMinutes[i]) {
                    column = i;
                    break;
                }
            }

            if (column === -1) {
                column = columnEndMinutes.length;
                columnEndMinutes.push(task.visualEndMinute);
            } else {
                columnEndMinutes[column] = task.visualEndMinute;
            }

            assigned.push({ task, column });
        }

        const columnCount = Math.max(1, columnEndMinutes.length);
        return assigned.map((item) => ({
            task: item.task,
            column: item.column,
            columnCount,
        }));
    }
}
