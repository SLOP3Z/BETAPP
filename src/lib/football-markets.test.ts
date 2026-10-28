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
  assert.ok(markets.every((market) => market.probability >= 55 && market.probability <= 82));
});

test("only returns team and match goal markets", () => {
  const markets = buildMarketCandidates({
    homeTeam: "Local FC",
    awayTeam: "Visitante FC",
    homeForm: { played: 8, goalsFor: 14, goalsAgainst: 8 },
    awayForm: { played: 8, goalsFor: 10, goalsAgainst: 12 },
  });

  assert.ok(markets.every((market) => !market.id.startsWith("player-")));
  assert.ok(markets.some((market) => market.category === "team-goals"));
});