import assert from "node:assert/strict";
import test from "node:test";
import { bestMarketCandidates, buildMarketCandidates, type TeamGoalForm } from "./football-markets.ts";

test("builds multiple total-goal lines from recent team form", () => {
  const markets = buildMarketCandidates(base);
  assert.ok(markets.some((market) => market.id === "match-goals-over-2.5"));
  assert.ok(markets.some((market) => market.id === "match-result-1"));
  assert.ok(markets.some((market) => market.id === "btts-yes"));
});

const homeStrong: TeamGoalForm = {
  played: 8,
  wins: 6,
  draws: 1,
  losses: 1,
  winStreak: 2,
  goalsFor: 18,
  goalsAgainst: 7,
  bothScored: 6,
};

const awayOpen: TeamGoalForm = {
  played: 8,
  wins: 2,
  draws: 2,
  losses: 4,
  winStreak: 0,
  goalsFor: 9,
  goalsAgainst: 15,
  bothScored: 6,
};

const base = {
  homeTeam: "Local FC",
  awayTeam: "Visitante FC",
  homeForm: homeStrong,
  awayForm: awayOpen,
};

test("uses home/away form and only recommends Over 2.5 for high combined scoring", () => {
  const markets = buildMarketCandidates(base);
  assert.ok(markets.some((market) => market.id === "match-goals-over-2.5"));
  assert.ok(!markets.some((market) => market.category === "match-goals" && market.id !== "match-goals-over-2.5"));
  assert.ok(markets.some((market) => market.category === "match-result"));
  assert.ok(markets.some((market) => market.id === "btts-yes"));
});

test("filters 1X2 when home and away results are too similar", () => {
  const evenHome: TeamGoalForm = {
    ...homeStrong,
    wins: 3,
    draws: 2,
    losses: 3,
    winStreak: 0,
  };
  const evenAway: TeamGoalForm = {
    ...awayOpen,
    wins: 3,
    draws: 2,
    losses: 3,
  };
  const markets = buildMarketCandidates({ ...base, homeForm: evenHome, awayForm: evenAway });
  assert.ok(!markets.some((market) => market.category === "match-result"));
});

test("uses venue-specific BTTS frequencies to choose yes or no", () => {
  const bothUnlikely = buildMarketCandidates({
    ...base,
    homeForm: { ...homeStrong, bothScored: 2 },
    awayForm: { ...awayOpen, bothScored: 3 },
  });
  assert.ok(bothUnlikely.some((market) => market.id === "btts-no"));
  assert.ok(!bothUnlikely.some((market) => market.id === "btts-yes"));

  const mixed = buildMarketCandidates({
    ...base,
    homeForm: { ...homeStrong, bothScored: 6 },
    awayForm: { ...awayOpen, bothScored: 3 },
  });
  assert.ok(!mixed.some((market) => market.category === "btts"));
});

test("does not recommend statistical markets with fewer than five venue matches", () => {
  const markets = buildMarketCandidates({
    ...base,
    homeForm: { ...homeStrong, played: 4 },
    awayForm: { ...awayOpen, played: 4 },
  });
  assert.ok(!markets.some((market) => ["match-result", "btts", "match-goals"].includes(market.category)));
});

test("allows Champions League predictions with two venue matches and labels the short sample", () => {
  const markets = buildMarketCandidates({
    ...base,
    homeForm: { ...homeStrong, played: 2, wins: 2, draws: 0, losses: 0, goalsFor: 4, goalsAgainst: 1, bothScored: 1 },
    awayForm: { ...awayOpen, played: 2, wins: 0, draws: 1, losses: 1, goalsFor: 1, goalsAgainst: 3, bothScored: 1 },
    minVenueMatches: 2,
  });

  assert.ok(markets.length > 0);
  assert.ok(markets.every((market) => market.evidence.includes("Muestra corta: 2 partidos")));
});

test("best options return distinct families, ordered by estimated probability", () => {
  const best = bestMarketCandidates(buildMarketCandidates(base));
  assert.ok(best.length <= 3);
  assert.equal(new Set(best.map((market) => market.category)).size, best.length);
  for (let index = 1; index < best.length; index += 1) {
    assert.ok(best[index - 1].probability >= best[index].probability);
  }
});

test("does not emit cards or shots without sufficient data", () => {
  assert.ok(!buildMarketCandidates(base).some((market) => market.category === "cards" || market.category === "shots"));
  const limited = buildMarketCandidates({
    ...base,
    referee: { name: "Árbitro X", cards: { average: 5.2, matches: 3 } },
    shots: { home: { average: 12, matches: 4 }, away: { average: 11, matches: 8 } },
  });
  assert.ok(!limited.some((market) => market.category === "cards" || market.category === "shots"));
});
