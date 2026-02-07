/**
 * Heading-based line insertion utility.
 * Pure function: takes content string, returns modified content string.
 * Reusable across daily notes and frontmatter task files.
 */
export class HeadingInserter {
    /**
     * Insert a line under a specific heading in file content.
     * If the heading exists, inserts directly under the heading (headerIndex + 1).
     * If the heading does not exist, creates it at the end of the file.
     *
     * @param content Full file content
     * @param line    Line to insert
     * @param header  Heading text (without # prefix)
     * @param headerLevel Number of # (e.g. 2 for ##)
     * @returns Modified file content
     */
    static insertUnderHeading(
        content: string,
        line: string,
        header: string,
        headerLevel: number
    ): string {
        const lines = content.split('\n');
        const headerPrefix = '#'.repeat(headerLevel) + ' ';
        const fullHeader = headerPrefix + header;

        let headerIndex = -1;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].trim() === fullHeader) {
                headerIndex = i;
                break;
            }
        }

        if (headerIndex !== -1) {
            // Insert directly under the heading
            lines.splice(headerIndex + 1, 0, line);
        } else {
            // Header doesn't exist - create it at end of file
            if (lines.length > 0 && lines[lines.length - 1].trim() !== '') {
                lines.push('');
            }
            lines.push(fullHeader);
            lines.push(line);
        }

        return lines.join('\n');
    }
}
