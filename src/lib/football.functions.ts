import { createServerFn } from "@tanstack/react-start";
import {
  bestMarketCandidates,
  buildMarketCandidates,
  type MarketCandidate,
} from "./football-markets";
import { parseFootballDataFixture, type FixtureRow } from "./football-data-fixtures";
import { TRACKED_COMPETITION_IDS } from "./football-competitions";

const REQUEST_TIMEOUT_MS = 45_000;
const FD = "https://api.football-data.org/v4";
const LEAGUE_CODE: Record<number, string> = {
  39: "PL",
  140: "PD",
  135: "SA",
  78: "BL1",
  61: "FL1",
  2: "CL",
};
const FD_CACHE_TTL_MS = 10 * 60 * 1000;
const fdCache = new Map<string, { matches: FdMatch[]; expiresAt: number }>();

type FdMatch = {
  utcDate?: string;
  status?: string;
  homeTeam?: { name?: string; shortName?: string };
  awayTeam?: { name?: string; shortName?: string };
  score?: { fullTime?: { home?: number | null; away?: number | null } };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const loadFixtures = createServerFn({ method: "POST" })
  .validator((data: { fdKey: string; date: string }) => {
    if (!data?.fdKey?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(data.date ?? "")) {
      throw new Error("Falta la clave de football-data.org o la fecha.");
    }
    return data;
  })
  .handler(async ({ data }) => {
    const res = await fetch(`${FD}/matches?date=${data.date}`, {
      headers: { "X-Auth-Token": data.fdKey },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = (await res.json()) as { message?: string; matches?: unknown[] };
    if (!res.ok) throw new Error(body.message || `football-data.org ${res.status}`);
    const rows = body.matches ?? [];
    const fixtures = rows
      .map(parseFootballDataFixture)
      .filter((fixture): fixture is FixtureRow => fixture !== null && TRACKED_COMPETITION_IDS.has(fixture.leagueId))
      .sort((a, b) => a.date.localeCompare(b.date));
    return { fixtures, scanned: rows.length };
  });

export type LiveStatus = {
  fixtureId: number;
  status: string;
  checkedAt: string;
};

type LiveStatusTarget = {
  id: number;
  leagueId: number;
  home: string;
  away: string;
};

type FdLiveMatch = {
  status?: string;
  competition?: { code?: string };
  homeTeam?: { name?: string; shortName?: string };
  awayTeam?: { name?: string; shortName?: string };
};

export const loadLiveStatuses = createServerFn({ method: "POST" })
  .validator((data: { fdKey: string; date: string; fixtures: LiveStatusTarget[] }) => {
    if (
      !data?.fdKey?.trim() ||
      !/^\d{4}-\d{2}-\d{2}$/.test(data.date ?? "") ||
      !Array.isArray(data.fixtures) ||
      data.fixtures.length === 0 ||
      data.fixtures.length > 100
    ) {
      throw new Error("Faltan datos válidos para consultar los estados de los partidos.");
    }
    return data;
  })
  .handler(async ({ data }) => {
    const res = await fetch(`${FD}/matches?date=${data.date}`, {
      headers: { "X-Auth-Token": data.fdKey },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = (await res.json()) as { message?: string; matches?: FdLiveMatch[] };
    if (!res.ok) throw new Error(body.message || `football-data.org ${res.status}`);

    const trackedCodes = new Set(Object.values(LEAGUE_CODE));
    const matches = (body.matches ?? []).filter((match) =>
      trackedCodes.has(match.competition?.code ?? ""),
    );
    const checkedAt = new Date().toISOString();
    const statuses: LiveStatus[] = [];

    for (const target of data.fixtures) {
      if (!TRACKED_COMPETITION_IDS.has(target.leagueId)) continue;
      const match = matches.find(
        (candidate) =>
          (sameTeam(candidate.homeTeam?.name, target.home) ||
            sameTeam(candidate.homeTeam?.shortName, target.home)) &&
          (sameTeam(candidate.awayTeam?.name, target.away) ||
            sameTeam(candidate.awayTeam?.shortName, target.away)),
      );
      if (!match?.status) continue;
      statuses.push({ fixtureId: target.id, status: match.status, checkedAt });
    }
    return { statuses };
  });

export type Prediction = {
  recommendations: Array<{
    id: string;
    title: string;
    selection: string;
    reason: string;
  }>;
};

function parsePrediction(value: unknown, candidates: MarketCandidate[]): Prediction {
  if (!isRecord(value) || !Array.isArray(value.recommendations)) {
    throw new Error("Gemini devolvió un pronóstico con un formato no válido.");
  }

  const reasonById = new Map<string, string>();
  for (const item of value.recommendations) {
    if (!isRecord(item) || typeof item.id !== "string" || typeof item.reason !== "string") continue;
    const reason = item.reason
      .replace(/\b\d+(?:[.,]\d+)?\s*%/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (reason) reasonById.set(item.id, reason);
  }
  const recommendations = candidates.slice(0, 3).map((candidate) => {
    const reason = reasonById.get(candidate.id) || candidate.evidence;
    return {
      id: candidate.id,
      title: candidate.title,
      selection: candidate.selection,
      reason: reason.length > 220 ? `${reason.slice(0, 217).trimEnd()}...` : reason,
    };
  });
  return { recommendations };
}

export const predictFixture = createServerFn({ method: "POST" })
  .validator(
    (data: {
      geminiKey: string;
      model: string;
      fdKey: string;
      fixture: FixtureRow;
    }) => {
      if (!data?.geminiKey || !data?.fdKey?.trim() || !data?.fixture?.id) {
        throw new Error("Faltan las claves de Gemini o football-data.org.");
      }
      return data;
    },
  )
  .handler(async ({ data }) => {
    const { fixture } = data;
    const code = LEAGUE_CODE[fixture.leagueId];
    if (!code) throw new Error("Esta competición no tiene una fuente de forma reciente configurada.");
    const matches = await finishedMatches(data.fdKey, code, fixture.season);
    const brief = {
      match: `${fixture.home} vs ${fixture.away}`,
      league: `${fixture.country} · ${fixture.league}`,
      source: `football-data.org, temporada ${fixture.season}`,
      h2h: h2hFrom(matches, fixture.home, fixture.away),
      home: formFrom(matches, fixture.home, "home"),
      away: formFrom(matches, fixture.away, "away"),
    };

    const markets = bestMarketCandidates(buildMarketCandidates({
      homeTeam: fixture.home,
      awayTeam: fixture.away,
      homeForm: brief.home,
      awayForm: brief.away,
    }));
    const marketContext = markets.map(({ id, title, selection, evidence }, index) => ({
      priority: index + 1,
      id,
      title,
      selection,
      evidence,
    }));

    const model = data.model || "gemini-3.5-flash-lite";
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(data.geminiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `Justifica brevemente cada candidato proporcionado, usando solo la forma y la evidencia adjuntas. Devuelve una recommendation por candidato, en el mismo orden, con su id exacto y una frase clara en español. No selecciones mercados nuevos ni cambies el orden. No devuelvas porcentajes, probabilidades, confianza ni cuotas. No inventes datos.\n${JSON.stringify({ brief, candidates: marketContext })}`,
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                recommendations: {
                  type: "ARRAY",
                  items: {
                    type: "OBJECT",
                    properties: {
                      id: { type: "STRING" },
                      reason: { type: "STRING" },
                    },
                    required: ["id", "reason"],
                  },
                },
              },
              required: ["recommendations"],
            },
            temperature: 0.2,
          },
        }),
      },
    );
    const gem = (await res.json().catch(() => null)) as {
      error?: { message?: string };
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    } | null;
    if (!res.ok || !gem || gem.error) {
      throw new Error(gem?.error?.message || `Gemini ${res.status}`);
    }
    const text = gem.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    if (!text) throw new Error("Gemini no devolvió un pronóstico.");
    let response: unknown;
    try {
      response = JSON.parse(text);
    } catch {
      throw new Error("Gemini devolvió una respuesta que no es JSON válido.");
    }
    const parsed = parsePrediction(response, markets);
    return { prediction: parsed, brief };
  });

async function finishedMatches(token: string, code: string, season: number) {
  const cacheKey = `${code}:${season}`;
  const cached = fdCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.matches;
  const res = await fetch(`${FD}/competitions/${code}/matches?season=${season}&status=FINISHED`, {
    headers: { "X-Auth-Token": token },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = (await res.json()) as { message?: string; matches?: FdMatch[] };
  if (!res.ok) throw new Error(body.message || `football-data.org ${res.status}`);
  const matches = body.matches ?? [];
  fdCache.set(cacheKey, { matches, expiresAt: Date.now() + FD_CACHE_TTL_MS });
  return matches;
}

function sameTeam(label: string | undefined, query: string) {
  const a = (label ?? "").toLowerCase();
  const b = query.toLowerCase();
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a) || a.split(" ").pop() === b.split(" ").pop();
}

function playedBy(match: FdMatch, team: string) {
  return sameTeam(match.homeTeam?.name, team) || sameTeam(match.homeTeam?.shortName, team) || sameTeam(match.awayTeam?.name, team) || sameTeam(match.awayTeam?.shortName, team);
}

function formFrom(matches: FdMatch[], team: string, venue: "home" | "away") {
  const rows = matches
    .filter((m) => {
      const teamIsHome = sameTeam(m.homeTeam?.name, team) || sameTeam(m.homeTeam?.shortName, team);
      return (
        playedBy(m, team) &&
        (venue === "home" ? teamIsHome : !teamIsHome) &&
        m.score?.fullTime?.home != null &&
        m.score.fullTime.away != null
      );
    })
    .sort((a, b) => (b.utcDate ?? "").localeCompare(a.utcDate ?? ""))
    .slice(0, 8);
  let w = 0;
  let d = 0;
  let l = 0;
  let gf = 0;
  let ga = 0;
  let bothScored = 0;
  let winStreak = 0;
  let streakOpen = true;
  const lines = rows.map((m) => {
    const home = m.score?.fullTime?.home ?? 0;
    const away = m.score?.fullTime?.away ?? 0;
    const isHome = sameTeam(m.homeTeam?.name, team) || sameTeam(m.homeTeam?.shortName, team);
    const mine = isHome ? home : away;
    const opp = isHome ? away : home;
    gf += mine;
    ga += opp;
    if (home > 0 && away > 0) bothScored += 1;
    if (mine > opp) {
      w += 1;
      if (streakOpen) winStreak += 1;
    }
    else if (mine === opp) d += 1;
    else l += 1;
    if (mine <= opp) streakOpen = false;
    const tag = mine > opp ? "G" : mine === opp ? "E" : "P";
    return `${tag} ${m.homeTeam?.shortName ?? m.homeTeam?.name} ${home}-${away} ${m.awayTeam?.shortName ?? m.awayTeam?.name}`;
  });
  return {
    played: lines.length,
    wins: w,
    draws: d,
    losses: l,
    winStreak,
    goalsFor: gf,
    goalsAgainst: ga,
    bothScored,
    matches: lines,
  };
}

function h2hFrom(matches: FdMatch[], home: string, away: string) {
  return matches
    .filter(
      (m) =>
        playedBy(m, home) &&
        playedBy(m, away) &&
        m.score?.fullTime?.home != null &&
        m.score.fullTime.away != null,
    )
    .sort((a, b) => (b.utcDate ?? "").localeCompare(a.utcDate ?? ""))
    .slice(0, 5)
    .map((m) => {
      const hg = m.score?.fullTime?.home ?? "-";
      const ag = m.score?.fullTime?.away ?? "-";
      return `${m.homeTeam?.name} ${hg}-${ag} ${m.awayTeam?.name}`;
    });
}
