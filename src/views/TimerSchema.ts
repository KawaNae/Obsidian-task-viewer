/**
 * TimerSchema — declarative persistence schema for the timer view.
 *
 * タイマービューはタスクに紐付かないので、他ビューが持つフィルタや日付アンカーは
 * 無い。往復するのはモードと、interval モードで選んだテンプレート名だけ。
 *
 * URI の `mode` / `intervalTemplate` は今も `ViewUriBuilder` が手書きで組み立てて
 * おり、この schema の語彙とは別系統。読み側（`main.ts` の `openTimerFromUri`）も
 * 同じく手書きで、どちらもここには通っていない。統合は C6 の担当。
 */

import { F } from '../services/viewConfig/FieldCodecs';
import { registerSchema } from '../services/viewConfig/SchemaRegistry';
import type { ViewSchema } from '../services/viewConfig/ViewConfigSchema';
import { VIEW_META_TIMER } from '../constants/viewRegistry';

/** モードの正。UI のメニューも setState の検証もここを見る。 */
export const TIMER_VIEW_MODES = ['countup', 'countdown', 'pomodoro', 'interval'] as const;
export type TimerViewMode = typeof TIMER_VIEW_MODES[number];

export interface TimerConfig {
    customName?: string;
    timerViewMode?: TimerViewMode;
    intervalTemplate?: string;
}

export const TimerSchema: ViewSchema<TimerConfig> = {
    viewType: VIEW_META_TIMER.type,
    shortName: 'timer',
    defaults: { timerViewMode: 'pomodoro' },
    config: {
        customName:       F.optionalString('customName'),
        // 旧 URI の `mode=` はここから読める（書き出しは常に `timerViewMode`）。
        timerViewMode:    F.stringEnum('timerViewMode', TIMER_VIEW_MODES, { legacyKeys: ['mode'] }),
        intervalTemplate: F.optionalString('intervalTemplate'),
    },
    transient: {},
};

registerSchema(TimerSchema);
