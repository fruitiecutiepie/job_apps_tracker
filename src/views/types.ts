import type { Application, OutcomeId, StateId, Status } from "../domain";

/** Moves an application along either axis; whatever the change leaves out is kept. */
export type MoveHandler = (id: string, change: Partial<Status>) => void;

/** Puts an application into the archive, or takes it back out. */
export type ArchiveHandler = (id: string, archived: boolean) => void;

export interface ApplicationsViewProps {
  applications: Application[];
  onOpen: (id: string) => void;
  onOpenStageNotes: (id: string) => void;
  /** Opens an application's captured job posting. Does nothing for one that has none. */
  onOpenPosting: (id: string) => void;
  /** Opens the application's form on one stage's messages. */
  onOpenMessages: (id: string, messagesFor: StateId) => void;
  /** Clears the next action and logs it in the notes. Views without a task row ignore it. */
  onCompleteAction: (id: string) => void;
  /**
   * The reader's Idle threshold, set on Statistics where it is also the ghosting one. Left
   * out it is the default, which is what a view rendered on its own in a test wants; the
   * app always passes the reader's value, so a card and Statistics cannot disagree.
   */
  quietDays?: number;
}

export interface MovableApplicationsViewProps extends ApplicationsViewProps {
  onMove: MoveHandler;
  onArchive: ArchiveHandler;
  visibleStates?: readonly StateId[];
  /** The outcomes the filter admits, or undefined for all of them. */
  visibleOutcomes?: readonly OutcomeId[];
}
