import { t } from '../../i18n';
import type { Issue, NotationKind, ShapeKind } from '../../utils/values/Read';

/**
 * An issue of a reading (`utils/values`) as a sentence in the user's
 * language, said under the field it was read from. The API and the CLI say
 * the same issue in English with `issueText`; `utils/values` imports no
 * i18n, so the two tables stand apart.
 */
export function issueWords(issue: Issue): string {
    switch (issue.code) {
        case 'empty': return t('issue.empty');
        case 'shape': return shapeWords(issue.kind);
        case 'noSuchDay': return t('issue.noSuchDay');
        case 'range':
            if (issue.min !== undefined && issue.max !== undefined) return t('issue.rangeBetween', { min: issue.min, max: issue.max });
            if (issue.min !== undefined) return t('issue.rangeAtLeast', { min: issue.min });
            return t('issue.rangeAtMost', { max: issue.max ?? '' });
        case 'oneOf': return t('issue.oneOf', { allowed: issue.allowed.join(', ') });
        case 'dateRequired': return t('issue.dateRequired');
        case 'notation': return notationWords(issue.kind);
        case 'chars': return t('issue.chars', { chars: issue.chars });
        case 'reserved': return t('issue.reserved');
    }
}

function notationWords(kind: NotationKind): string {
    switch (kind) {
        case 'dateBlock': return t('issue.notation.dateBlock');
        case 'command': return t('issue.notation.command');
        case 'blockId': return t('issue.notation.blockId');
    }
}

function shapeWords(kind: ShapeKind): string {
    switch (kind) {
        case 'date': return t('issue.shape.date');
        case 'time': return t('issue.shape.time');
        case 'dateTime': return t('issue.shape.dateTime');
        case 'dateTimeOrTime': return t('issue.shape.dateTimeOrTime');
        case 'int': return t('issue.shape.int');
        case 'number': return t('issue.shape.number');
        case 'bool': return t('issue.shape.bool');
        case 'color': return t('issue.shape.color');
    }
}
