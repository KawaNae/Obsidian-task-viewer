import type { DisplayTask } from '../../types';
import { minutesOfSpan } from '../../utils/DayWindow';
import { buildOverlapClusters } from '../sharedLogic/OverlapClusters';

/**
 * Where a timed card sits in its day's lane: its width and left offset, in
 * percent of the lane, and its rank, the place it stands in front of the
 * day's other cards (1 is the back, the number of cards the front).
 *
 * `bandGap` is, in minutes, how long after the start of the nearest card
 * whose name band may hang over this card's top this card starts: of the
 * cards in front of it that end by its start and whose band, with its halo,
 * lies over it from side to side, the one that starts last. A short card's
 * band hangs a fixed height from its own top, so CSS turns the gap into how
 * much of this card's top the band covers, at whatever zoom; a card in
 * front with no band yields nothing there. Absent when no card can.
 */
export interface LaneSlot {
    width: number;
    left: number;
    rank: number;
    bandGap?: number;
}

/**
 * The lane the cards are laid out in, in px: `width` is what the cards'
 * percentages are of, and `bandInset` how far in from a card's left edge
 * its name band's halo starts; the band reaches the card's right edge. A
 * band covers only the cards it lies over right of that, not those under
 * its notch.
 */
export interface LaneGeometry {
    width: number;
    bandInset: number;
}

export class TaskLayout {
    /**
     * `lane` is the lane as drawn. Without it (a lane not laid out yet) a
     * band is taken to lie over the card's whole width.
     */
    static calculateTaskLayout(tasks: DisplayTask[], startHour: number, lane?: LaneGeometry): Map<string, LaneSlot> {
        const layout = new Map<string, LaneSlot>();
        if (tasks.length === 0) return layout;

        // 1. What each task is drawn over, in minutes of its visual day.
        const preparedTasks = tasks.filter(task => task.drawn).map(task => ({
            task,
            ...minutesOfSpan(task.drawn!, startHour),
        }));

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

        // Each card's level and span, gathered across clusters for the ranks.
        const placed: { id: string; level: number; start: number; end: number }[] = [];

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

                layout.set(item.task.id, { width, left, rank: 0 });
                placed.push({ id: item.task.id, level, start: item.start, end: item.end });
            }
        }

        // 5. Rank the day's cards, back to front. A card in front of another
        //    traces the part of its outline over the other in the view's
        //    background colour.
        //    - Two cards whose times overlap have different levels, and the
        //      one shifted right (the higher level) stands in front.
        //    - Two cards of one level never overlap in time. The earlier one
        //      stands in front, so that a short card's name band, which hangs
        //      below its end, lies over the card after it.
        //    Comparing levels first keeps the order total where the two
        //    pairwise rules would go round in a circle (Q 20:00-20:10 level 1,
        //    P 20:05-21:00 level 2, R 20:10-20:20 level 3: R, P, Q front to
        //    back). One level and one start only meet for a card of no length
        //    beside a longer one; the one ending first stands in front, as an
        //    earlier card does, and the ID settles the rest.
        placed.sort((a, b) => {
            if (a.level !== b.level) return a.level - b.level;
            if (a.start !== b.start) return b.start - a.start;
            if (a.end !== b.end) return b.end - a.end;
            return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
        });
        placed.forEach((p, i) => {
            layout.get(p.id)!.rank = i + 1;
        });

        // 6. The gap to the card whose band may hang over each card's top.
        //    Only a card in front can lie over it, and only one that ends by
        //    its start hangs a band there: a card in front whose time
        //    overlaps it (two cards starting together, the shorter shifted
        //    right) covers it with its body, not with a band. Of those, the
        //    one starting last lies lowest over its top. The same level is
        //    not enough to find it: a card shifted right in one cluster lies
        //    over the first card of the next, and a card of no length stands
        //    in front of a longer one starting with it.
        const scale = lane ? lane.width / 100 : 1;
        const bandInset = lane ? lane.bandInset : 0;
        for (const n of placed) {
            const below = layout.get(n.id)!;
            const belowLeft = below.left * scale;
            const belowRight = (below.left + below.width) * scale;
            let gap: number | undefined;
            for (const p of placed) {
                const front = layout.get(p.id)!;
                if (front.rank <= below.rank || p.end > n.start) continue;
                const bandStart = front.left * scale + bandInset;
                const bandEnd = (front.left + front.width) * scale;
                if (bandStart >= belowRight || bandEnd <= belowLeft) continue;
                const g = n.start - p.start;
                if (gap === undefined || g < gap) gap = g;
            }
            if (gap !== undefined) below.bandGap = gap;
        }

        return layout;
    }
}
