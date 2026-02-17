import type { ClusteredTaskAssignment, TimedRenderableTask } from '../ScheduleTypes';

export class ScheduleOverlapLayout {
    buildOverlapClusters(tasks: TimedRenderableTask[]): TimedRenderableTask[][] {
        const sorted = tasks.slice().sort((a, b) => {
            if (a.visualStartMinute !== b.visualStartMinute) {
                return a.visualStartMinute - b.visualStartMinute;
            }
            if (a.visualEndMinute !== b.visualEndMinute) {
                return b.visualEndMinute - a.visualEndMinute;
            }
            const fileDiff = a.file.localeCompare(b.file);
            if (fileDiff !== 0) return fileDiff;
            return a.line - b.line;
        });

        const clusters: TimedRenderableTask[][] = [];
        let currentCluster: TimedRenderableTask[] = [];
        let clusterMaxEnd = -1;

        for (const task of sorted) {
            if (currentCluster.length === 0) {
                currentCluster.push(task);
                clusterMaxEnd = task.visualEndMinute;
                continue;
            }

            // Timeline と同じ判定: start >= 現クラスタ最大end なら別クラスタ
            if (task.visualStartMinute >= clusterMaxEnd) {
                clusters.push(currentCluster);
                currentCluster = [task];
                clusterMaxEnd = task.visualEndMinute;
            } else {
                currentCluster.push(task);
                clusterMaxEnd = Math.max(clusterMaxEnd, task.visualEndMinute);
            }
        }

        if (currentCluster.length > 0) {
            clusters.push(currentCluster);
        }

        return clusters;
    }

    assignClusterColumns(cluster: TimedRenderableTask[]): ClusteredTaskAssignment[] {
        const sorted = cluster.slice().sort((a, b) => {
            if (a.visualStartMinute !== b.visualStartMinute) {
                return a.visualStartMinute - b.visualStartMinute;
            }
            if (a.visualEndMinute !== b.visualEndMinute) {
                return b.visualEndMinute - a.visualEndMinute;
            }
            const fileDiff = a.file.localeCompare(b.file);
            if (fileDiff !== 0) return fileDiff;
            return a.line - b.line;
        });

        const columnEndMinutes: number[] = [];
        const assigned: Array<{ task: TimedRenderableTask; column: number }> = [];

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
