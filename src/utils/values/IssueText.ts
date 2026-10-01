import type { Issue, ShapeKind } from './Read';

/**
 * An issue as one English sentence, for the API's and the CLI's errors
 * (which are in English). `label` names the value (`due`, `limit`); `given`,
 * when passed, is the text that was read, quoted at the end.
 *
 * A form in the app tells the same issue through i18n instead (stage 10).
 */

const SHAPE: Record<ShapeKind, string> = {
    date: 'a date (YYYY-MM-DD)',
    time: 'a time (HH:mm)',
    dateTime: 'a date (YYYY-MM-DD) or a date and a time (YYYY-MM-DD HH:mm)',
    dateTimeOrTime: 'a date (YYYY-MM-DD), a date and a time (YYYY-MM-DD HH:mm), or a time (HH:mm)',
    int: 'a whole number',
    number: 'a number',
    bool: 'true or false',
};

function sentence(issue: Issue, label: string): string {
    switch (issue.code) {
        case 'empty': return `${label} must not be empty`;
        case 'shape': return `${label} must be ${SHAPE[issue.kind]}`;
        case 'noSuchDay': return `${label} must be a day that exists`;
        case 'range':
            if (issue.min !== undefined && issue.max !== undefined) return `${label} must be from ${issue.min} to ${issue.max}`;
            if (issue.min !== undefined) return `${label} must be at least ${issue.min}`;
            return `${label} must be at most ${issue.max}`;
        case 'oneOf': return `${label} must be one of: ${issue.allowed.join(', ')}`;
        case 'dateRequired': return `${label} must include a date`;
    }
}

export function issueText(issue: Issue, label: string, given?: string): string {
    const text = sentence(issue, label);
    return given === undefined ? text : `${text}, got: ${JSON.stringify(given)}`;
}
