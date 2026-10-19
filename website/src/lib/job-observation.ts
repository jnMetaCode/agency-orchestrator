/** A persisted nonterminal state cannot prove that a worker survived a server restart. */
export function jobObservation(job: { status: string; activeInThisInstance?: boolean }, stale = false): "active" | "unconfirmed" | "recorded" {
  if (stale) return "unconfirmed";
  if (job.activeInThisInstance === true) return "active";
  return ["completed", "failed", "cancelled", "interrupted"].includes(job.status) ? "recorded" : "unconfirmed";
}
