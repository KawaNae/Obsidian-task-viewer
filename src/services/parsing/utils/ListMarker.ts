/**
 * Shared bullet-marker fragment for markdown list items: `-`, `*`, `+`, or
 * an ordered marker (`1.`/`1)`). Interpolate into a larger regex rather than
 * writing the pattern out again — every parser that recognizes a list line
 * needs the same definition of "bullet".
 */
export const LIST_BULLET_SOURCE = '(?:[-*+]|\\d+[.)])';
