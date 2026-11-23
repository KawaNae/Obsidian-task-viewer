import { t } from '../i18n';
import type { TimelineOverlapMode } from '../types';

/**
 * The name of each way Timeline lays out overlapping cards
 * (`TimelineOverlapMode`), shared by the global setting's dropdown and a
 * view's gear menu so that both say the same.
 */
export const OVERLAP_MODE_LABEL: Record<TimelineOverlapMode, () => string> = {
    cascade: () => t('settings.views.overlapModeCascade'),
    auto: () => t('settings.views.overlapModeAuto'),
    sideBySide: () => t('settings.views.overlapModeSideBySide'),
};
