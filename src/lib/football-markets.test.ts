import assert from "node:assert/strict";
import test from "node:test";
import { bestMarketCandidates, buildMarketCandidates, type MarketCandidate } from "./football-markets.ts";

test("builds multiple total-goal lines from recent team form", () => {
  const markets = buildMarketCandidates({
    homeTeam: "Local FC",
    awayTeam: "Visitante FC",
    homeForm: { played: 8, goalsFor: 14, goalsAgainst: 8 },
    awayForm: { played: 8, goalsFor: 10, goalsAgainst: 12 },
  });

  assert.ok(markets.some((market) => market.id === "match-goals-over-1.5"));
  assert.ok(markets.some((market) => market.id === "match-goals-under-3.5"));
  assert.ok(markets.every((market) => market.probability >= 45));
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

test("best options keep one per family and put a stronger 1X2 ahead of goals", () => {
  const candidates: MarketCandidate[] = [
    { id: "goal-top", category: "match-goals", title: "Goles totales", selection: "Más de 2.5", probability: 70, evidence: "goles", sampleSize: 8 },
    { id: "goal-other", category: "team-goals", title: "Goles local", selection: "Más de 1.5", probability: 68, evidence: "local", sampleSize: 8 },
    { id: "result-top", category: "match-result", title: "1X2", selection: "Gana local", probability: 78, evidence: "victorias", sampleSize: 8 },
    { id: "btts-top", category: "btts", title: "Ambos marcan", selection: "Sí", probability: 74, evidence: "ambos", sampleSize: 8 },
  ];
  const best = bestMarketCandidates(candidates);

  assert.deepEqual(best.map((market) => market.id), ["result-top", "btts-top", "goal-top"]);
});
