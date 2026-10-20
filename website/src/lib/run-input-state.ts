export interface PendingRunInput {
  inputRequestId: string;
  stepId: string;
  prompt: string;
  type: "human_input" | "approval";
}
export interface RunInputSnapshot { active: boolean; pendingInput: PendingRunInput | null; }


interface Owner {
  state: string;
  pendingInput?: PendingRunInput | null;
  _inputVersion?: number;
}

/** A snapshot must not replace a newer streamed question or terminal state. */
export async function reconcileRunInput(owner: Owner, fetchSnapshot: () => Promise<RunInputSnapshot>) {
  const version = (owner._inputVersion ?? 0) + 1;
  owner._inputVersion = version;
  const snapshot = await fetchSnapshot();
  if (owner._inputVersion !== version || owner.state !== "running") return false;
  owner.pendingInput = snapshot.active ? snapshot.pendingInput : null;
  return true;
}
