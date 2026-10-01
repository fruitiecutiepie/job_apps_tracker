import type { Application, StateId } from "../domain";

export interface ApplicationsViewProps {
  applications: Application[];
  onOpen: (id: string) => void;
  onOpenStageNotes: (id: string) => void;
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
  onMove: (id: string, state: StateId) => void;
  visibleStates?: readonly StateId[];
}
