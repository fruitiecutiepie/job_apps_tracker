import type { Application, StateId } from "../domain";

export interface ApplicationsViewProps {
  applications: Application[];
  onOpen: (id: string) => void;
  onOpenStageNotes: (id: string) => void;
  /** Clears the next action and logs it in the notes. Views without a task row ignore it. */
  onCompleteAction: (id: string) => void;
}

export interface MovableApplicationsViewProps extends ApplicationsViewProps {
  onMove: (id: string, state: StateId) => void;
  visibleStates?: readonly StateId[];
}
