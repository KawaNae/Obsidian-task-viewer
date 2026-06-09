/**
 * 区間の重なりクラスタ検出（interval sweep）。
 *
 * 「開始順に並べ、直前までのクラスタ最大 end を跨がなければ同じクラスタ、
 * 跨いだら新クラスタ」という 1 パスの sweep。Timeline / Schedule の両ビューが
 * 同一のアルゴリズムを別々に持っていた（cascade 幅圧縮 / column 等分割という
 * クラスタ「内」の配置だけが視覚契約として異なる）。検出ロジックはここに一本化し、
 * 配置は各ビューが従来通り担当する。
 *
 * 座標系には非依存: 数値の start/end を取り出す accessor と、tie-break を含む
 * 並べ替え comparator を呼び出し側が渡す（ドメイン固有の安定順序を保持するため）。
 *
 * @param items     クラスタ化する要素
 * @param compare   並べ替え順序（start 昇順 + tie-break）。元配列は変更しない
 * @param getStart  要素の開始座標（数値）
 * @param getEnd    要素の終了座標（数値）
 * @returns 並べ替え順を保ったクラスタの配列
 */
export function buildOverlapClusters<T>(
    items: T[],
    compare: (a: T, b: T) => number,
    getStart: (item: T) => number,
    getEnd: (item: T) => number,
): T[][] {
    const sorted = items.slice().sort(compare);

    const clusters: T[][] = [];
    let currentCluster: T[] = [];
    let clusterMaxEnd = -1;

    for (const item of sorted) {
        if (currentCluster.length === 0) {
            currentCluster.push(item);
            clusterMaxEnd = getEnd(item);
            continue;
        }

        // start が現クラスタの最大 end 以上なら重ならない → 別クラスタ
        if (getStart(item) >= clusterMaxEnd) {
            clusters.push(currentCluster);
            currentCluster = [item];
            clusterMaxEnd = getEnd(item);
        } else {
            currentCluster.push(item);
            clusterMaxEnd = Math.max(clusterMaxEnd, getEnd(item));
        }
    }

    if (currentCluster.length > 0) {
        clusters.push(currentCluster);
    }

    return clusters;
}
