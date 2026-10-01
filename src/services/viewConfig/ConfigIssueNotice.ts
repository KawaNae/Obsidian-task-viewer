import { Notice } from 'obsidian';
import { t } from '../../i18n';
import { logWarn } from '../../log/log';
import type { ConfigIssue } from './ViewConfigSchema';
import type { ViewConfigCodec } from './ViewConfigCodec';

/**
 * Tell the user that a view's config lost parts it could not read (a filter
 * condition, a sort rule): one notice with the count, and one log line for
 * each part, saying where it was and why. The view opens on the rest.
 *
 * Every road a config takes into a view tells through here: the workspace
 * (`setState`), a template applied from the toolbar, and a URI.
 */
export function noticeConfigIssues(issues: readonly ConfigIssue[]): void {
    if (issues.length === 0) return;
    for (const issue of issues) {
        logWarn(`[config] ${issue.field}: dropped ${issue.text}`);
    }
    new Notice(t('notice.unreadableConditions', { count: issues.length }));
}

/**
 * A config a view applies — from the workspace or a template — read by
 * `codec`, with what it dropped told to the user.
 */
export function readViewConfig<TConfig extends object, TTransient extends object>(
    codec: ViewConfigCodec<TConfig, TTransient>,
    raw: Record<string, unknown> | undefined | null,
): Partial<TConfig> {
    const issues: ConfigIssue[] = [];
    const config = codec.parseConfig(raw, issues);
    noticeConfigIssues(issues);
    return config;
}
