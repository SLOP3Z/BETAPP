export const TRACKED_COMPETITIONS = [
  { id: 39, name: "Premier League" },
  { id: 45, name: "FA Cup" },
  { id: 48, name: "EFL Cup" },
  { id: 528, name: "Community Shield" },
  { id: 140, name: "La Liga" },
  { id: 141, name: "LaLiga2" },
  { id: 143, name: "Copa del Rey" },
  { id: 556, name: "Supercopa de España" },
  { id: 135, name: "Serie A" },
  { id: 137, name: "Coppa Italia" },
  { id: 547, name: "Supercoppa Italiana" },
  { id: 78, name: "Bundesliga" },
  { id: 81, name: "DFB Pokal" },
  { id: 529, name: "DFL-Supercup" },
  { id: 61, name: "Ligue 1" },
  { id: 66, name: "Coupe de France" },
  { id: 526, name: "Trophée des Champions" },
  { id: 2, name: "Champions League" },
  { id: 3, name: "Europa League" },
  { id: 848, name: "Conference League" },
  { id: 531, name: "UEFA Super Cup" },
] as const;

export const TRACKED_COMPETITION_IDS = new Set<number>(
  TRACKED_COMPETITIONS.map(({ id }) => id),
);