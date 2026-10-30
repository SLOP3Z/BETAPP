export type RetainedPick = {
  at: string;
  fixture: { date: string; status?: string };
  live?: { status: string };
};

export const MAX_FINISHED_HISTORY_DAYS = 30;
export const MAX_FINISHED_HISTORY_COUNT = 100;

const FINAL_STATUSES = new Set(["FINISHED", "FT", "AET", "PEN"]);
const DAY_MS = 24 * 60 * 60 * 1000;

export function isFinishedPick(pick: RetainedPick): boolean {
  return FINAL_STATUSES.has(pick.live?.status ?? pick.fixture.status ?? "");
}

export function pruneHistory<T extends RetainedPick>(
  picks: T[],
  now = Date.now(),
): T[] {
  const cutoff = now - MAX_FINISHED_HISTORY_DAYS * DAY_MS;
  const completed = picks
    .filter(isFinishedPick)
    .filter((pick) => {
      const playedAt = Date.parse(pick.fixture.date);
      return Number.isFinite(playedAt) && playedAt >= cutoff;
    })
    .sort((a, b) => Date.parse(b.fixture.date) - Date.parse(a.fixture.date))
    .slice(0, MAX_FINISHED_HISTORY_COUNT);
  const keepCompleted = new Set(completed);
  return picks.filter((pick) => !isFinishedPick(pick) || keepCompleted.has(pick));
}