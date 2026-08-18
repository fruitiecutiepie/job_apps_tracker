import type { Application, StateId } from "../domain";

export interface ApplicationsViewProps {
  applications: Application[];
  onOpen: (id: string) => void;
  onOpenStageNotes: (id: string) => void;
}

export interface MovableApplicationsViewProps extends ApplicationsViewProps {
  onMove: (id: string, state: StateId) => void;
  visibleStates?: readonly StateId[];
}
