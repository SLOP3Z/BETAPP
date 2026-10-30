import assert from "node:assert/strict";
import test from "node:test";
import { parseFootballDataFixture } from "./football-data-fixtures.ts";

test("parses a current football-data.org fixture and its live status", () => {
  const fixture = parseFootballDataFixture({
    id: 501,
    utcDate: "2026-10-30T19:00:00Z",
    status: "IN_PLAY",
    matchday: 12,
    area: { name: "England" },
    competition: { code: "PL", name: "Premier League" },
    season: { startDate: "2026-08-01", endDate: "2027-05-30" },
    homeTeam: { name: "Home FC" },
    awayTeam: { name: "Away FC" },
  });

  assert.deepEqual(fixture, {
    id: 501,
    date: "2026-10-30T19:00:00Z",
    leagueId: 39,
    season: 2026,
    league: "Premier League",
    country: "England",
    round: "Jornada 12",
    home: "Home FC",
    away: "Away FC",
    status: "IN_PLAY",
  });
});

test("rejects unsupported competitions and malformed fixture responses", () => {
  assert.equal(
    parseFootballDataFixture({
      id: 1,
      utcDate: "2026-10-30T19:00:00Z",
      competition: { code: "EL", name: "Europa League" },
      season: { startDate: "2026-08-01" },
      homeTeam: { name: "Home" },
      awayTeam: { name: "Away" },
    }),
    null,
  );
  assert.equal(parseFootballDataFixture(null), null);
});