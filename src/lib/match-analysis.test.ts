import assert from "node:assert/strict";
import test from "node:test";
import { buildMarketCandidates, type TeamGoalForm } from "./football-markets.ts";
import { buildMatchAnalysis, leagueAveragesFrom } from "./match-analysis.ts";

const home: TeamGoalForm = { played: 8, wins: 6, draws: 1, losses: 1, winStreak: 2, goalsFor: 18, goalsAgainst: 7, bothScored: 6 };
const away: TeamGoalForm = { played: 8, wins: 2, draws: 2, losses: 4, winStreak: 0, goalsFor: 9, goalsAgainst: 15, bothScored: 5 };

function analysis(homeForm = home, awayForm = away) {
  return buildMatchAnalysis({
    homeForm,
    awayForm,
    minVenueMatches: 5,
    competitionMatches: [],
    homeRecentLines: ["G A 2-0 B", "E A 1-1 C", "P D 3-0 A"],
    awayRecentLines: [],
  });
}

test("1X2 percentages sum to 100 and agree with the recommendation model", () => {
  const a = analysis();
  assert.ok(a.result);
  assert.equal(a.result.home + a.result.draw + a.result.away, 100);
  const candidates = buildMarketCandidates({ homeTeam: "A", awayTeam: "B", homeForm: home, awayForm: away });
  for (const [id, value] of [["match-result-1", a.result.home], ["match-result-x", a.result.draw], ["match-result-2", a.result.away]] as const) {
    const candidate = candidates.find((c) => c.id === id);
    if (candidate) assert.ok(Math.abs(candidate.probability - value) <= 1, id);
  }
});

test("over 2.5 matches the recommendation model", () => {
  const a = analysis();
  const candidate = buildMarketCandidates({ homeTeam: "A", awayTeam: "B", homeForm: home, awayForm: away })
    .find((c) => c.id === "match-goals-over-2.5");
  assert.ok(a.keyProbabilities && candidate);
  assert.equal(a.keyProbabilities.over25, candidate.probability);
  assert.ok(a.keyProbabilities.over15 > a.keyProbabilities.over25);
});

test("returns no numbers when the venue sample is too small", () => {
  const a = analysis({ ...home, played: 3 }, away);
  assert.equal(a.result, null);
  assert.equal(a.expectedGoals, null);
  assert.equal(a.keyProbabilities, null);
});

test("form tags keep the last results, most recent first", () => {
  assert.deepEqual(analysis().form.home, ["G", "E", "P"]);
});

test("last matches drop the result letter", () => {
  assert.deepEqual(analysis().lastMatches.home, ["A 2-0 B", "A 1-1 C", "D 3-0 A"]);
});

test("league averages need a minimum sample and count goals correctly", () => {
  const score = (home: number, away: number) => ({ score: { fullTime: { home, away } } });
  assert.equal(leagueAveragesFrom([score(1, 0)]), null);
  const matches = [...Array(10).fill(score(2, 1)), ...Array(10).fill(score(0, 0))];
  const avg = leagueAveragesFrom(matches);
  assert.ok(avg);
  assert.equal(avg.matches, 20);
  assert.equal(avg.goals, 1.5);
  assert.equal(avg.over25, 50);
  assert.equal(avg.over15, 50);
  assert.equal(avg.btts, 50);
});
