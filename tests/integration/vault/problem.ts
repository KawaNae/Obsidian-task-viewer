/** Something the E2E suite needs that does not hold: what was seen, and what puts it right. */
export interface Problem {
    what: string;
    fix: string;
}

/** The problems as one message, each with its fix, under `heading`. */
export function describeProblems(heading: string, problems: readonly Problem[]): string {
    return [
        heading,
        ...problems.map((p, i) => `  ${i + 1}. ${p.what}\n     fix: ${p.fix}`),
    ].join('\n');
}
