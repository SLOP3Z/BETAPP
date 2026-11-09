import assert from "node:assert/strict";
import test from "node:test";
import {
  analyzeMatch,
  bestTennisPicks,
  buildPlayerForm,
  formWinProbability,
  marketProbability,
  overProbability,
  parsePastMatches,
  parseScore,
  parseUpcomingMatches,
  setWinProbability,
  surfaceFromCourt,
  totalGamesDistribution,
  type PlayedMatch,
  type TennisFixture,
} from "./tennis-model.ts";

const upcoming = {
  total: 4,
  matches: [
    {
      liveMatchId: "47275-68074-20380-12",
      date: "2026-11-15T14:00:00.000Z",
      roundId: 12,
      tournament: { id: 20380, name: "Nitto ATP Finals", rankId: 7, court: { id: 3, name: "I.hard" } },
      player1: { id: 47275, name: "Jannik Sinner", seed: "1", odd: "1.60" },
      player2: { id: 68074, name: "Carlos Alcaraz", seed: "2", odd: "2.35" },
      odds: { id1_o: 68074, id2_o: 47275, k1: 2.3, k2: 1.62, total: 2.5, ktb: 1.9, ktm: 1.9 },
      h2hSummary: { matchCount: 12, player1Wins: 6, player2Wins: 6 },
    },
    {
      liveMatchId: "1-2-3-4",
      tournament: { id: 3, name: "Challenger X", rankId: 1, court: { name: "Clay" } },
      player1: { id: 1, name: "A" },
      player2: { id: 2, name: "B" },
    },
    {
      liveMatchId: "5-6-7-8",
      tournament: { id: 7, name: "Roland Garros", rankId: 4, court: { name: "Clay" } },
      player1: { id: 5, name: "C" },
      player2: { id: 6, name: "D", members: [{ id: 9, name: "E" }] },
    },
    {
      liveMatchId: "9-10-11-5",
      tournament: { id: 11, name: "Roland Garros", rankId: 4, court: { name: "Clay" } },
      player1: { id: 9, name: "Unknown Player" },
      player2: { id: 10, name: "F" },
    },
  ],
};

test("keeps only the tournaments the app follows and drops doubles and placeholders", () => {
  const fixtures = parseUpcomingMatches(upcoming, "atp");
  assert.equal(fixtures.length, 1);
  assert.equal(fixtures[0]?.tournament.name, "Nitto ATP Finals");
});

test("assigns the odds by player id when the API lists the pair the other way round", () => {
  const fixture = parseUpcomingMatches(upcoming, "atp")[0];
  assert.deepEqual(fixture?.odds, { player1: 1.62, player2: 2.3 });
});

test("WTA only keeps the tour finals", () => {
  const body = { matches: [
    { tournament: { id: 1, name: "WTA 1000", rankId: 3, court: { name: "Hard" } }, player1: { id: 1, name: "A" }, player2: { id: 2, name: "B" } },
    { tournament: { id: 2, name: "WTA Finals", rankId: 7, court: { name: "I.hard" } }, player1: { id: 3, name: "C" }, player2: { id: 4, name: "D" } },
  ] };
  assert.deepEqual(parseUpcomingMatches(body, "wta").map((f) => f.tournament.name), ["WTA Finals"]);
});

test("Grand Slam men play best of five, everything else best of three", () => {
  const slam = { matches: [{ tournament: { id: 7, name: "Wimbledon", rankId: 4, court: { name: "Grass" } }, player1: { id: 5, name: "C" }, player2: { id: 6, name: "D" } }] };
  assert.equal(parseUpcomingMatches(slam, "atp")[0]?.bestOf, 5);
  assert.equal(parseUpcomingMatches(upcoming, "atp")[0]?.bestOf, 3);
});

test("surface mapping groups indoor hard and carpet with hard", () => {
  assert.equal(surfaceFromCourt(3), "hard");
  assert.equal(surfaceFromCourt(null, "Clay"), "clay");
  assert.equal(surfaceFromCourt(5), "grass");
  assert.equal(surfaceFromCourt(null, null), null);
});

test("parses scores with tie-breaks and rejects retirements", () => {
  assert.deepEqual(parseScore("6-3 6-7(7) 6-7(0) 7-5 6-3"), { winnerGames: 31, loserGames: 25, winnerSets: 3, loserSets: 2 });
  assert.equal(parseScore("6-3 2-1 ret."), null);
  assert.equal(parseScore("6-3 6-4", "retired"), null);
});

const history = {
  data: [
    { date: "2025-09-07T00:00:00.000Z", result: "6-2 3-6 6-1 6-4", player1Id: 68074, player2Id: 47275, result_type: "completed", tournament: { courtId: 1 } },
    { date: "2025-07-13T00:00:00.000Z", result: "4-6 6-4 6-4 6-4", player1Id: 47275, player2Id: 68074, result_type: "completed", tournament: { court: { id: 5, name: "Grass" } } },
    { date: "2025-06-01T00:00:00.000Z", result: "6-3 6-0", player1Id: 47275, player2Id: 999, result_type: "completed", tournament: { courtId: 2 } },
  ],
};

test("player1 of a completed match is the winner: results are read from the right side", () => {
  const sinner = parsePastMatches(history, 47275);
  assert.deepEqual(sinner.map((m) => m.won), [false, true, true]);
  assert.deepEqual(sinner[0]?.games, { for: 13, against: 21 });
  const alcaraz = parsePastMatches(history, 68074);
  assert.deepEqual(alcaraz.map((m) => m.won), [true, false]);
});

function played(results: Array<[boolean, "hard" | "clay" | "grass"]>): PlayedMatch[] {
  return results.map(([won, surface], i) => ({
    date: `2026-${String(10 - Math.floor(i / 3)).padStart(2, "0")}-${String(28 - i).padStart(2, "0")}`,
    won,
    surface,
    games: { for: won ? 12 : 8, against: won ? 8 : 12 },
    sets: { for: won ? 2 : 0, against: won ? 0 : 2 },
  }));
}

test("a player with better recent and surface form is the favourite, and the model is symmetric", () => {
  const strong = buildPlayerForm(played(Array(10).fill([true, "hard"]) as Array<[boolean, "hard"]>), "hard");
  const weak = buildPlayerForm(played(Array(10).fill([false, "hard"]) as Array<[boolean, "hard"]>), "hard");
  const a = formWinProbability(strong, weak, null);
  const b = formWinProbability(weak, strong, null);
  assert.ok(a > 0.7);
  assert.ok(Math.abs(a + b - 1) < 1e-9);
});

test("market probability removes the bookmaker margin", () => {
  const p = marketProbability({ player1: 1.5, player2: 2.5 });
  assert.ok(p !== null && Math.abs(p - 0.625) < 1e-9);
  assert.equal(marketProbability(null), null);
});

test("set win probability inverts the match win probability", () => {
  for (const bestOf of [3, 5] as const) {
    for (const p of [0.3, 0.5, 0.7, 0.9]) {
      const q = setWinProbability(p, bestOf);
      const back = bestOf === 3 ? q * q * (3 - 2 * q) : q ** 3 * (10 - 15 * q + 6 * q * q);
      assert.ok(Math.abs(back - p) < 1e-6);
    }
  }
});

test("the total games distribution sums to one and a longer match has more games", () => {
  const even = totalGamesDistribution(0.5, 3, 9.6);
  const sum = [...even.values()].reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  const lopsided = totalGamesDistribution(0.95, 3, 9.6);
  assert.ok(overProbability(even, 20.5) > overProbability(lopsided, 20.5));
  assert.ok(overProbability(even, 30.5) < overProbability(even, 20.5));
});

const fixture: TennisFixture = parseUpcomingMatches(upcoming, "atp")[0] as TennisFixture;

test("analysis returns at most one pick per market and keeps probabilities in range", () => {
  const strong = played(Array(10).fill([true, "hard"]) as Array<[boolean, "hard"]>);
  const weak = played(Array(10).fill([false, "hard"]) as Array<[boolean, "hard"]>);
  const analysis = analyzeMatch(fixture, strong, weak, null);
  const picks = bestTennisPicks(analysis.candidates);
  assert.ok(picks.length >= 1 && picks.length <= 3);
  assert.equal(new Set(picks.map((p) => p.market)).size, picks.length);
  assert.ok(analysis.candidates.every((c) => c.probability >= 52 && c.probability <= 85));
  assert.ok(analysis.player1WinProbability > 0.5);
});

test("surface head-to-head replaces the overall record only with at least two meetings", () => {
  const form = played(Array(8).fill([true, "hard"]) as Array<[boolean, "hard"]>);
  const withSurface = analyzeMatch(fixture, form, form, { matches: 3, player1Wins: 3, player2Wins: 0 });
  const withoutSurface = analyzeMatch(fixture, form, form, { matches: 1, player1Wins: 1, player2Wins: 0 });
  assert.ok(withSurface.formProbability > withoutSurface.formProbability);
});

import { parseSurfaceH2H, sanitizeFixture } from "./tennis-model.ts";

test("surface head-to-head sums the courts that belong to the match surface", () => {
  const body = { data: [
    { courtId: 1, court: "Hard", player1wins: "4", player2wins: "3" },
    { courtId: 3, court: "I.hard", player1wins: "1", player2wins: "0" },
    { courtId: 2, court: "Clay", player1wins: "2", player2wins: "2" },
  ] };
  assert.deepEqual(parseSurfaceH2H(body, "hard"), { matches: 8, player1Wins: 5, player2Wins: 3 });
  assert.equal(parseSurfaceH2H(body, "grass"), null);
  assert.equal(parseSurfaceH2H(body, null), null);
});

test("a fixture sent by the browser is rebuilt, and tampered ones are rejected", () => {
  const ok = sanitizeFixture(JSON.parse(JSON.stringify(fixture)));
  assert.deepEqual(ok, fixture);
  assert.equal(sanitizeFixture({ ...fixture, tour: "itf" }), null);
  assert.equal(sanitizeFixture({ ...fixture, tournament: { ...fixture.tournament, rankId: 1 } }), null);
  assert.equal(sanitizeFixture("x"), null);
});
