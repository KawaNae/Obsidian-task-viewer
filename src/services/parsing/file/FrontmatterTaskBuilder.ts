import { Task } from '../../../types';
import { FRONTMATTER_TIMER_TARGET_KEY } from '../../../utils/TimerTargetIdUtils';

/**
 * Frontmatter からタスクを構築する静的ユーティリティ。
 * ParserStrategy ではない（frontmatter はファイルレベルの操作）。
 * TaskIndex.scanFile から呼び出される。
 */
export class FrontmatterTaskBuilder {

    /**
     * frontmatter オブジェクトから Task を構築する。
     * タスク関連フィールド (start/end/deadline) がない場合は null を返す。
     */
    static parse(filePath: string, frontmatter: Record<string, any> | undefined, bodyLines: string[], bodyStartIndex: number = 0): Task | null {
        if (!frontmatter) return null;

        // クイックゲート: start / end / deadline のいずれかのキーが存在するか
        if (!('start' in frontmatter) && !('end' in frontmatter) && !('deadline' in frontmatter)) {
            return null;
        }

        // 各フィールドのパース
        const startNorm = this.normalizeYamlDate(frontmatter['start']);
        const start = this.parseDateTimeField(startNorm);

        const endNorm = this.normalizeYamlDate(frontmatter['end']);
        const end = this.parseDateTimeField(endNorm);

        const deadlineNorm = this.normalizeYamlDate(frontmatter['deadline']);
        const deadlineParsed = this.parseDateTimeField(deadlineNorm);

        // インライン記法と同様: 日付・時刻フィールドが1つもなければタスクではない
        if (!start.date && !start.time && !end.date && !end.time && !deadlineParsed.date) {
            return null;
        }

        // status: null/undefined/'' → ' '(todo); それ以外は最初の文字を使う
        const rawStatus = frontmatter['status'];
        const statusChar = (rawStatus === null || rawStatus === undefined || String(rawStatus).trim() === '')
            ? ' '
            : String(rawStatus).trim()[0];

        // content: 空の場合はファイル名（拡張子なし）を使う
        const rawContent = frontmatter['content'];
        const fileName = filePath.split('/').pop()?.replace(/\.md$/, '') || '';
        const content = (rawContent != null && String(rawContent).trim() !== '')
            ? String(rawContent).trim()
            : fileName;

        const rawTimerTargetId = frontmatter[FRONTMATTER_TIMER_TARGET_KEY];
        const timerTargetId = (rawTimerTargetId == null || String(rawTimerTargetId).trim() === '')
            ? undefined
            : String(rawTimerTargetId).trim();

        // deadline: YYYY-MM-DD または YYYY-MM-DDThh:mm で保存（インライン と同じ）
        let deadline: string | undefined;
        if (deadlineParsed.date) {
            deadline = deadlineParsed.time
                ? `${deadlineParsed.date}T${deadlineParsed.time}`
                : deadlineParsed.date;
        }

        // childLines: frontmatter タスクは body チェックボックスを収集しない。
        // @notation タスクは TaskScanner が個別の Task として解析し childIds でリンクする。
        // WikiLinkResolver 用に wikilink ターゲットのみ抽出する。
        const childLines: string[] = [];
        const childBodyIndices: number[] = [];

        const wikiLinkTargets: string[] = [];
        const wikiLinkBodyLines: number[] = [];
        // リスト項目の最小インデントを求め、トップレベルの wikilink のみ抽出
        const listItemRegex = /^(\s*)-\s/;
        let minListIndent = Infinity;
        for (const line of bodyLines) {
            const m = line.match(listItemRegex);
            if (m) minListIndent = Math.min(minListIndent, m[1].length);
        }
        const wikiRegex = /^(\s*)-\s+\[\[([^\]]+)\]\]\s*$/;
        for (let i = 0; i < bodyLines.length; i++) {
            const match = bodyLines[i].match(wikiRegex);
            if (match && match[1].length === minListIndent) {
                wikiLinkTargets.push(match[2].trim());
                wikiLinkBodyLines.push(bodyStartIndex + i);
            }
        }

        return {
            id: `${filePath}:-1`,
            file: filePath,
            line: -1,                           // frontmatter タスクには該当行なし（種別判定は parserId を使用）
            content,
            statusChar,
            indent: 0,
            childIds: [],                       // scanFile で親子接続時に populated
            childLines,
            childLineBodyOffsets: childBodyIndices,
            startDate: start.date,
            startTime: start.time,
            endDate: end.date,
            endTime: end.time,
            deadline,
            explicitStartDate: !!start.date,
            explicitStartTime: !!start.time,
            explicitEndDate: !!end.date,
            explicitEndTime: !!end.time,
            wikiLinkTargets,
            wikiLinkBodyLines,
            originalText: '',                   // frontmatter task has no single original line
            commands: [],                       // flow commands are not used for frontmatter tasks
            timerTargetId,
            parserId: 'frontmatter'
        };
    }

    /**
     * YAML パーサーによる型変換のエッジケースを正規化する。
     * js-yaml (YAML 1.1 デフォルト) の動作:
     *   - `2026-02-10` → Date オブジェクト
     *   - `2026-02-10T14:00` → Date オブジェクト
     *   - `14:00` → 数値 840 (sexagesimal: 14*60+0)
     *   - `start:` (値なし) → null
     */
    static normalizeYamlDate(value: unknown): string | null {
        if (value === null || value === undefined) return null;

        if (value instanceof Date) {
            // toISOString() は UTC に変換するため使わない（日付がずれる）
            // ローカル時間のコンポーネントを直接取得する
            const y = value.getFullYear();
            const m = (value.getMonth() + 1).toString().padStart(2, '0');
            const d = value.getDate().toString().padStart(2, '0');
            const h = value.getHours();
            const min = value.getMinutes();
            if (h === 0 && min === 0) {
                return `${y}-${m}-${d}`;
            }
            return `${y}-${m}-${d}T${h.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`;
        }

        if (typeof value === 'number') {
            // YAML 1.1: `14:00` は sexagesimal で 840 になる
            // 0〜1439 の範囲なら時刻として解釈する
            if (value >= 0 && value < 1440) {
                const hours = Math.floor(value / 60);
                const minutes = value % 60;
                return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
            }
            return null;
        }

        if (typeof value === 'string') {
            const trimmed = value.trim();
            return trimmed.length > 0 ? trimmed : null;
        }

        // その他の型はfallback
        return String(value).trim() || null;
    }

    /**
     * 正規化された日時文字列を date と time に分割する。
     * TaskViewerParser.parseDateTime (line 192) と同じ正規表現を使用し、動作の一貫性を保つ。
     */
    static parseDateTimeField(normalized: string | null): { date?: string; time?: string } {
        if (!normalized) return {};
        const dateMatch = normalized.match(/(\d{4}-\d{2}-\d{2})/);
        const timeMatch = normalized.match(/(\d{2}:\d{2})/);
        return {
            date: dateMatch ? dateMatch[1] : undefined,
            time: timeMatch ? timeMatch[1] : undefined
        };
    }
}
