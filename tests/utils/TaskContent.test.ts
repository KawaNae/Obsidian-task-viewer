import { describe, it, expect } from 'vitest';
import { hasTaskContent, getFileBaseName, isContentMatchingBaseName, getTaskDisplayName } from '../../src/services/parsing/utils/TaskContent';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('hasTaskContent', () => {
    it('returns true for non-empty content', () => {
        expect(hasTaskContent({ content: 'Buy milk' })).toBe(true);
    });

    it('returns false for empty string', () => {
        expect(hasTaskContent({ content: '' })).toBe(false);
    });

    it('returns false for whitespace-only', () => {
        expect(hasTaskContent({ content: '   ' })).toBe(false);
    });
});

describe('getFileBaseName', () => {
    it('strips .md extension', () => {
        expect(getFileBaseName('project.md')).toBe('project');
    });

    it('returns basename from subfolder path', () => {
        expect(getFileBaseName('notes/tasks/project.md')).toBe('project');
    });

    it('returns empty string for empty path', () => {
        expect(getFileBaseName('')).toBe('');
    });

    it('preserves name without .md', () => {
        expect(getFileBaseName('readme.txt')).toBe('readme.txt');
    });
});

describe('isContentMatchingBaseName', () => {
    it('returns true when content matches file basename', () => {
        expect(isContentMatchingBaseName({ content: 'project', file: 'project.md' })).toBe(true);
    });

    it('returns false when content differs', () => {
        expect(isContentMatchingBaseName({ content: 'other', file: 'project.md' })).toBe(false);
    });

    it('returns false for empty content', () => {
        expect(isContentMatchingBaseName({ content: '', file: 'project.md' })).toBe(false);
    });
});

describe('getTaskDisplayName', () => {
    it('returns content when present', () => {
        expect(getTaskDisplayName({ content: 'Buy milk', file: 'tasks.md' })).toBe('Buy milk');
    });

    it('falls back to file basename when content is empty', () => {
        expect(getTaskDisplayName({ content: '', file: 'project.md' })).toBe('project');
    });

    it('returns "Untitled" when both content and basename are empty', () => {
        expect(getTaskDisplayName({ content: '', file: '' })).toBe('Untitled');
    });

    it('trims whitespace from content', () => {
        expect(getTaskDisplayName({ content: '  Hello  ', file: 'x.md' })).toBe('Hello');
    });
});
