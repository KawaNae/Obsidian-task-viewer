import type { TaskViewerSettings } from '../../types';
import type { InSection } from './utils/Placement';

/**
 * A section new lines go to (`Placement.into`), and the level its heading is
 * made at when the note has none by its name (`Notes.sectionSpot`).
 */
export interface Section extends InSection {
    level: number;
}

type SectionSettings = Pick<TaskViewerSettings, 'taskHeading' | 'taskHeadingLevel' | 'sectionSide'>;

/**
 * Where a new line goes, read off the settings in one place: the heading a
 * task goes under when nothing names one, the level a heading is made at, and
 * which end of the section it goes to.
 */
export const Destination = {
    /** The section a new task goes to when nothing names one: a task made in the daily note, a timer's record there. */
    taskSection(settings: SectionSettings): Section {
        return this.sectionNamed(settings.taskHeading, settings);
    },

    /** The section of the heading named `heading`, made at the settings' level, at the settings' side: a task the API makes under a heading. */
    sectionNamed(heading: string, settings: SectionSettings): Section {
        return { heading, level: settings.taskHeadingLevel, side: settings.sectionSide };
    },
};
