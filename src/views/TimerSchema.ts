/**
 * TimerSchema — declarative persistence schema for the timer view.
 *
 * タイマービューはタスクに紐付かないので、他ビューが持つフィルタや日付アンカーは
 * 無い。往復するのは名前とモードと、interval モードで選んだテンプレート名だけ。
 *
 * ワークスペースの保存も URI も、他のビューと同じくこの schema を通る。Copy URI
 * は `codec.toUriParams` で正の鍵（`timerViewMode`）を書き、`obsidian://` の読み
 * 側は `buildViewStateFromParams` で読む。ビューのテンプレートは持たない。
 */

import { F } from '../services/viewConfig/FieldCodecs';
import { ViewConfigCodec } from '../services/viewConfig/ViewConfigCodec';
import type { ViewSchema } from '../services/viewConfig/ViewConfigSchema';

/** モードの正。UI のメニューも setState の検証もここを見る。 */
export const TIMER_VIEW_MODES = ['countup', 'countdown', 'pomodoro', 'interval'] as const;
export type TimerViewMode = typeof TIMER_VIEW_MODES[number];

export interface TimerConfig {
    customName?: string;
    timerViewMode?: TimerViewMode;
    intervalTemplate?: string;
}

export const TimerSchema: ViewSchema<TimerConfig> = {
    viewType: 'timer-view',
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

/** The codec of this schema; the views, toolbars and the view table share this instance. */
export const TimerCodec = new ViewConfigCodec(TimerSchema);
