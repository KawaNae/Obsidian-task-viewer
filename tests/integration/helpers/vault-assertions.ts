import { readTestFile } from './test-file-manager';

/**
 * Read a file from the Dev vault and return its lines.
 */
export function getFileLines(relativePath: string): string[] {
    return readTestFile(relativePath).split('\n');
}

/**
 * Extract the YAML frontmatter block as a raw key-value map.
 * Only handles simple `key: value` lines (not nested YAML).
 */
export function getFrontmatterRaw(relativePath: string): Record<string, string> {
    const lines = getFileLines(relativePath);
    const result: Record<string, string> = {};

    if (lines[0]?.trim() !== '---') return result;

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.trim() === '---') break;

        const colonIdx = line.indexOf(':');
        if (colonIdx > 0) {
            const key = line.slice(0, colonIdx).trim();
            const value = line.slice(colonIdx + 1).trim();
            result[key] = value;
        }
    }
    return result;
}

/**
 * Assert that a specific frontmatter key has the expected value.
 */
export function expectFrontmatterKey(
    relativePath: string,
    key: string,
    expected: string,
): void {
    const fm = getFrontmatterRaw(relativePath);
    const actual = fm[key];
    if (actual !== expected) {
        throw new Error(
            `Frontmatter key "${key}" in ${relativePath}: expected "${expected}", got "${actual}"`,
        );
    }
}

/**
 * Assert that a specific line contains the expected substring.
 * @param lineIndex  0-based line index
 */
export function expectLineContains(
    relativePath: string,
    lineIndex: number,
    expected: string,
): void {
    const lines = getFileLines(relativePath);
    if (lineIndex >= lines.length) {
        throw new Error(
            `Line ${lineIndex} does not exist in ${relativePath} (${lines.length} lines total)`,
        );
    }
    if (!lines[lineIndex].includes(expected)) {
        throw new Error(
            `Line ${lineIndex} in ${relativePath}: expected to contain "${expected}", got "${lines[lineIndex]}"`,
        );
    }
}

/**
 * Assert that the file content contains the given substring.
 */
export function expectFileContains(relativePath: string, expected: string): void {
    const content = readTestFile(relativePath);
    if (!content.includes(expected)) {
        throw new Error(
            `File ${relativePath}: expected to contain "${expected}"`,
        );
    }
}

/**
 * Assert that the file content does NOT contain the given substring.
 */
export function expectFileNotContains(relativePath: string, unexpected: string): void {
    const content = readTestFile(relativePath);
    if (content.includes(unexpected)) {
        throw new Error(
            `File ${relativePath}: expected NOT to contain "${unexpected}"`,
        );
    }
}
