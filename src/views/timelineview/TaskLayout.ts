import type { DisplayTask } from '../../types';
import { DateUtils } from '../../utils/DateUtils';
import { buildOverlapClusters } from '../sharedLogic/OverlapClusters';

export class TaskLayout {
    static calculateTaskLayout(tasks: DisplayTask[], date: string, startHour: number): Map<string, { width: number, left: number, zIndex: number }> {
        const layout = new Map<string, { width: number, left: number, zIndex: number }>();
        if (tasks.length === 0) return layout;

        const startHourMinutes = startHour * 60;

        // Helper to get adjusted minutes (minutes from visual start)
        const getAdjustedMinutes = (task: DisplayTask, timeStr: string, isEnd: boolean) => {
            let m: number;

            if (timeStr.includes('T')) {
                const startDate = new Date(`${date}T00:00:00`);
                const endDate = new Date(timeStr);
                const diffMs = endDate.getTime() - startDate.getTime();
                m = Math.floor(diffMs / 60000);
            } else {
                m = DateUtils.timeToMinutes(timeStr);
            }

            // Adjust for visual day
            // If it's simple time and < startHour, it's next day (add 24h)
            if (!timeStr.includes('T') && m < startHourMinutes) {
                m += 24 * 60;
            }

            return m;
        };

        // 1. Prepare tasks with calculated start/end for sorting
        const preparedTasks = tasks.map(task => {
            const start = getAdjustedMinutes(task, task.effectiveStartTime!, false);
            let end = task.effectiveEndTime ? getAdjustedMinutes(task, task.effectiveEndTime, true) : start + DateUtils.DEFAULT_TIMED_DURATION_MINUTES;
            // Fix simple wrap for end time if needed
            if (!task.effectiveEndTime?.includes('T') && end < start) end += 24 * 60;

            return { task, start, end };
        });

        // 2-3. Sort by start time (longer first on tie) and group into overlap clusters.
        const clusters = buildOverlapClusters(
            preparedTasks,
            (a, b) => {
                if (a.start !== b.start) return a.start - b.start;
                return (b.end - b.start) - (a.end - a.start);
            },
            item => item.start,
            item => item.end,
        );

        // 4. Process each cluster independently
        for (const cluster of clusters) {
            // Sort cluster by start time (critical for waterfall logic)
            // If start times are equal, longer tasks go first (so shorter ones sit on top)
            cluster.sort((a, b) => {
                if (a.start !== b.start) return a.start - b.start;
                return (b.end - b.start) - (a.end - a.start);
            });

            // Map to store assigned levels for tasks in this cluster
            const taskLevels = new Map<string, number>();
            const processedItems: typeof preparedTasks = [];

            for (const item of cluster) {
                let maxOverlappingLevel = 0;

                // Find all previously processed tasks that overlap with current item
                for (const processed of processedItems) {
                    // Check overlap
                    if (item.start < processed.end && item.end > processed.start) {
                        const level = taskLevels.get(processed.task.id) || 0;
                        if (level > maxOverlappingLevel) {
                            maxOverlappingLevel = level;
                        }
                    }
                }

                // Assign level = max + 1
                const currentLevel = maxOverlappingLevel + 1;
                taskLevels.set(item.task.id, currentLevel);
                processedItems.push(item);
            }

            // Cluster-uniform width cascade: 全カードを同じ幅 f(maxLevel) にして
            // level に応じて左から step ずつオフセット。背面カードも左端 step% が
            // 必ず露出するので視認性が上がる（旧: level1=100%, level2=90%... と
            // 後方カードほど狭くなり、前面カードに完全に隠されていた）。
            //
            // 配置イメージ (maxLevel=3, STEP=15):
            //   level 1: left=0%,  width=70%  → 0..70
            //   level 2: left=15%, width=70%  → 15..85
            //   level 3: left=30%, width=70%  → 30..100
            const CASCADE_STEP = 15;
            const MIN_WIDTH = 40;

            // cluster の最大 level を取得（最深 overlap）
            let maxLevel = 1;
            for (const item of cluster) {
                const level = taskLevels.get(item.task.id) || 1;
                if (level > maxLevel) maxLevel = level;
            }

            // f(n) = max(MIN_WIDTH, 100 - (n-1) * STEP)
            const desiredWidth = 100 - (maxLevel - 1) * CASCADE_STEP;
            const width = Math.max(MIN_WIDTH, desiredWidth);
            // 幅が MIN_WIDTH に張り付いた場合は step を縮めて全幅 100% に収める
            const step = maxLevel > 1 ? (100 - width) / (maxLevel - 1) : 0;

            for (const item of cluster) {
                const level = taskLevels.get(item.task.id) || 1;
                const stepIndex = level - 1;

                const left = stepIndex * step;
                const zIndex = level;

                layout.set(item.task.id, { width, left, zIndex });
            }
        }

        return layout;
    }
}
