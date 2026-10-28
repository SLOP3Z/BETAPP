import assert from "node:assert/strict";
import test from "node:test";
import { buildMarketCandidates } from "./football-markets.ts";

test("builds multiple total-goal lines from recent team form", () => {
  const markets = buildMarketCandidates({
    homeTeam: "Local FC",
    awayTeam: "Visitante FC",
    homeForm: { played: 8, goalsFor: 14, goalsAgainst: 8 },
    awayForm: { played: 8, goalsFor: 10, goalsAgainst: 12 },
    players: [],
  });

  assert.ok(markets.some((market) => market.id === "match-goals-over-1.5"));
  assert.ok(markets.some((market) => market.id === "match-goals-under-3.5"));
  assert.ok(markets.every((market) => market.probability >= 55 && market.probability <= 82));
});

test("adds player props only with a usable appearance sample", () => {
  const markets = buildMarketCandidates({
    homeTeam: "Local FC",
    awayTeam: "Visitante FC",
    homeForm: { played: 8, goalsFor: 14, goalsAgainst: 8 },
    awayForm: { played: 8, goalsFor: 10, goalsAgainst: 12 },
    players: [
      {
        id: 7,
        name: "Delantero",
        team: "Local FC",
        appearances: 12,
        goals: 6,
        shots: 35,
        shotsOnTarget: 17,
        foulsCommitted: 8,
        foulsDrawn: 19,
        yellowCards: 2,
      },
      {
        id: 8,
        name: "Muestra pequeña",
        team: "Visitante FC",
        appearances: 2,
        goals: 2,
        shots: 8,
      },
    ],
  });

  assert.ok(markets.some((market) => market.category === "player" && market.title.startsWith("Delantero")));
  assert.ok(!markets.some((market) => market.title.startsWith("Muestra pequeña")));
});