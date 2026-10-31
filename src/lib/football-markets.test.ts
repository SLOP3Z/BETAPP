import assert from "node:assert/strict";
import test from "node:test";
import { buildMarketCandidates } from "./football-markets.ts";

test("builds multiple total-goal lines from recent team form", () => {
  const markets = buildMarketCandidates({
    homeTeam: "Local FC",
    awayTeam: "Visitante FC",
    homeForm: { played: 8, goalsFor: 14, goalsAgainst: 8 },
    awayForm: { played: 8, goalsFor: 10, goalsAgainst: 12 },
  });

  assert.ok(markets.some((market) => market.id === "match-goals-over-1.5"));
  assert.ok(markets.some((market) => market.id === "match-goals-under-3.5"));
  assert.ok(
    markets
      .filter((market) => market.category !== "match-result")
      .every((market) => market.probability >= 55 && market.probability <= 82),
  );
});

test("never returns player markets", () => {
  const markets = buildMarketCandidates({
    homeTeam: "Local FC",
    awayTeam: "Visitante FC",
    homeForm: { played: 8, goalsFor: 14, goalsAgainst: 8 },
    awayForm: { played: 8, goalsFor: 10, goalsAgainst: 12 },
  });

  assert.ok(markets.every((market) => !market.id.startsWith("player-")));
  assert.ok(markets.some((market) => market.category === "team-goals"));
});

const base = {
  homeTeam: "Local FC",
  awayTeam: "Visitante FC",
  homeForm: { played: 8, goalsFor: 14, goalsAgainst: 8 },
  awayForm: { played: 8, goalsFor: 10, goalsAgainst: 12 },
};

test("adds 1X2 and both-teams-to-score markets", () => {
  const markets = buildMarketCandidates(base);
  assert.ok(markets.some((market) => market.category === "match-result"));
  assert.ok(markets.every((market) => market.id !== "match-result-x" || market.probability >= 45));
  for (const market of markets.filter((m) => m.category === "match-result")) {
    assert.ok(market.probability <= 82);
  }
});

test("1X2 probabilities of a lopsided match favour the strong home side", () => {
  const markets = buildMarketCandidates({
    ...base,
    homeForm: { played: 8, goalsFor: 24, goalsAgainst: 4 },
    awayForm: { played: 8, goalsFor: 6, goalsAgainst: 20 },
  });
  const home = markets.find((market) => market.id === "match-result-1");
  assert.ok(home && home.probability > 60);
});

test("cards and shots markets appear only with enough data", () => {
  assert.ok(!buildMarketCandidates(base).some((m) => m.category === "cards" || m.category === "shots"));
  const markets = buildMarketCandidates({
    ...base,
    referee: { name: "Árbitro X", cards: { average: 5.2, matches: 3 } },
  });
  assert.ok(!markets.some((m) => m.category === "cards"), "muestra de árbitro demasiado pequeña");
  const withData = buildMarketCandidates({
    ...base,
    referee: { name: "Árbitro X", cards: { average: 5.2, matches: 20 } },
    shots: { home: { average: 12, matches: 8 }, away: { average: 11, matches: 8 } },
  });
  assert.ok(withData.some((m) => m.category === "cards"));
  assert.ok(withData.some((m) => m.category === "shots"));
});

test("candidates are sorted from most to least probable", () => {
  const markets = buildMarketCandidates(base);
  for (let i = 1; i < markets.length; i += 1) {
    assert.ok(markets[i - 1].probability >= markets[i].probability);
  }
});
