export const TRACKED_COMPETITIONS = [
  { id: 39, name: "Premier League" },
  { id: 140, name: "La Liga" },
  { id: 135, name: "Serie A" },
  { id: 78, name: "Bundesliga" },
  { id: 61, name: "Ligue 1" },
  { id: 2, name: "Champions League" },
] as const;

export const TRACKED_COMPETITION_IDS = new Set<number>(
  TRACKED_COMPETITIONS.map(({ id }) => id),
);