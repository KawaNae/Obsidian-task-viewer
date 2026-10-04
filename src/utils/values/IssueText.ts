import type { Issue, NotationKind, ShapeKind } from './Read';

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
    color: 'a hex color (ff0000) or a color name (red)',
};

const NOTATION: Record<NotationKind, string> = {
    dateBlock: 'a date block (@…); dates go in their own fields',
    command: 'a command (==>)',
    blockId: 'a block ID (^id) at its end',
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
        case 'notation': return `${label} must not hold ${NOTATION[issue.kind]}`;
        case 'chars': return `${label} must not hold: ${issue.chars}`;
        case 'reserved': return `${label} is reserved`;
    }
}

export function issueText(issue: Issue, label: string, given?: string): string {
    const text = sentence(issue, label);
    return given === undefined ? text : `${text}, got: ${JSON.stringify(given)}`;
}
