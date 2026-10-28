import { createServerFn } from "@tanstack/react-start";
import {
  buildMarketCandidates,
  type MarketCandidate,
  type PlayerSeasonStats,
} from "./football-markets";
import { TRACKED_COMPETITION_IDS } from "./football-competitions";

const FOOTBALL = "https://v3.football.api-sports.io";
const REQUEST_TIMEOUT_MS = 45_000;
type FixtureRow = {
  id: number;
  date: string;
  leagueId: number;
  season: number;
  league: string;
  country: string;
  round: string;
  home: string;
  away: string;
  homeId: number;
  awayId: number;
  status: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseFixture(value: unknown): FixtureRow | null {
  if (!isRecord(value)) return null;
  const fixture = value.fixture;
  const league = value.league;
  const teams = value.teams;
  if (!isRecord(fixture) || !isRecord(league) || !isRecord(teams)) return null;

  const home = teams.home;
  const away = teams.away;
  const status = fixture.status;
  if (!isRecord(home) || !isRecord(away)) return null;
  if (
    typeof fixture.id !== "number" ||
    typeof fixture.date !== "string" ||
    typeof league.id !== "number" ||
    typeof league.name !== "string" ||
    typeof home.id !== "number" ||
    typeof home.name !== "string" ||
    typeof away.id !== "number" ||
    typeof away.name !== "string"
  ) {
    return null;
  }

  return {
    id: fixture.id,
    date: fixture.date,
    leagueId: league.id,
    season:
      typeof league.season === "number"
        ? league.season
        : new Date(fixture.date).getUTCFullYear(),
    league: league.name,
    country: typeof league.country === "string" ? league.country : "Desconocido",
    round: typeof league.round === "string" ? league.round : "",
    home: home.name,
    away: away.name,
    homeId: home.id,
    awayId: away.id,
    status: isRecord(status) && typeof status.short === "string" ? status.short : "",
  };
}

async function football(path: string, key: string) {
  const res = await fetch(`${FOOTBALL}${path}`, {
    headers: { "x-apisports-key": key },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = (await res.json()) as {
    errors?: unknown;
    response?: unknown;
    results?: number;
    paging?: { current?: number; total?: number };
  };
  const remaining = res.headers.get("x-ratelimit-requests-remaining");
  if (!res.ok || (body.errors && Object.keys(body.errors as object).length)) {
    const msg =
      typeof body.errors === "object"
        ? JSON.stringify(body.errors)
        : `API-Football ${res.status}`;
    throw new Error(msg);
  }
  return { body, remaining };
}

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

export const loadFixtures = createServerFn({ method: "POST" })
  .validator((data: { apiKey: string; date: string }) => {
    if (!data?.apiKey || !/^\d{4}-\d{2}-\d{2}$/.test(data.date ?? "")) {
      throw new Error("Faltan la key o la fecha.");
    }
    return data;
  })
  .handler(async ({ data }) => {
    const { body, remaining } = await football(`/fixtures?date=${data.date}`, data.apiKey);
    const rows = Array.isArray(body.response) ? body.response : [];
    const fixtures = rows
      .map(parseFixture)
      .filter((fixture): fixture is FixtureRow => fixture !== null && TRACKED_COMPETITION_IDS.has(fixture.leagueId))
      .sort((a, b) => a.date.localeCompare(b.date));
    return { fixtures, remaining, scanned: rows.length };
  });

export type Prediction = {
  pick: "1" | "X" | "2";
  probs: { home: number; draw: number; away: number };
  over25: number;
  btts: number;
  confidence: number;
  reason: string;
  recommendations: MarketCandidate[];
};

function parsePrediction(value: unknown, candidates: MarketCandidate[]): Prediction {
  if (!isRecord(value) || !isRecord(value.probs)) {
    throw new Error("Gemini devolvió un pronóstico con un formato no válido.");
  }

  const { home, draw, away } = value.probs;
  const percentages = [home, draw, away, value.over25, value.btts, value.confidence];
  if (
    (value.pick !== "1" && value.pick !== "X" && value.pick !== "2") ||
    percentages.some((number) => typeof number !== "number" || !Number.isFinite(number) || number < 0 || number > 100) ||
    Math.abs((home as number) + (draw as number) + (away as number) - 100) > 1 ||
    typeof value.reason !== "string"
  ) {
    throw new Error("Gemini devolvió un pronóstico incompleto o fuera de rango.");
  }

  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const recommendationIds = Array.isArray(value.bestMarketIds)
    ? value.bestMarketIds.filter((id): id is string => typeof id === "string")
    : [];
  const recommendations = [...new Set(recommendationIds)]
    .map((id) => candidateById.get(id))
    .filter((candidate): candidate is MarketCandidate => candidate !== undefined)
    .slice(0, 3);

  return {
    pick: value.pick,
    probs: { home: home as number, draw: draw as number, away: away as number },
    over25: value.over25 as number,
    btts: value.btts as number,
    confidence: value.confidence as number,
    reason: value.reason,
    recommendations,
  };
}

function numberField(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function nestedRecord(value: unknown, key: string): Record<string, unknown> | null {
  if (!isRecord(value) || !isRecord(value[key])) return null;
  return value[key] as Record<string, unknown>;
}

function sumPlayerMetric(
  statistics: unknown[],
  section: string,
  field: string,
): number | undefined {
  const values = statistics
    .map((stat) => numberField(nestedRecord(stat, section)?.[field]))
    .filter((value): value is number => value !== undefined);
  return values.length ? values.reduce((total, value) => total + value, 0) : undefined;
}

function parsePlayerRows(value: unknown, team: string): PlayerSeasonStats[] {
  if (!Array.isArray(value)) return [];
  const players: PlayerSeasonStats[] = [];
  for (const row of value) {
    if (!isRecord(row) || !isRecord(row.player) || !Array.isArray(row.statistics)) continue;
    const appearances = sumPlayerMetric(row.statistics, "games", "appearences");
    if (typeof row.player.id !== "number" || typeof row.player.name !== "string" || !appearances) continue;

    players.push({
      id: row.player.id,
      name: row.player.name,
      team,
      appearances,
      goals: sumPlayerMetric(row.statistics, "goals", "total"),
      shots: sumPlayerMetric(row.statistics, "shots", "total"),
      shotsOnTarget: sumPlayerMetric(row.statistics, "shots", "on"),
      foulsCommitted: sumPlayerMetric(row.statistics, "fouls", "committed"),
      foulsDrawn: sumPlayerMetric(row.statistics, "fouls", "drawn"),
      yellowCards: sumPlayerMetric(row.statistics, "cards", "yellow"),
    });
  }
  return players;
}

async function loadTeamPlayerStats(
  apiKey: string,
  fixture: FixtureRow,
  teamId: number,
  teamName: string,
): Promise<PlayerSeasonStats[]> {
  const query = `team=${teamId}&season=${fixture.season}`;
  const first = await football(`/players?${query}&page=1`, apiKey);
  const players = parsePlayerRows(first.body.response, teamName);
  const pageCount = Math.min(first.body.paging?.total ?? 1, 2);
  if (pageCount > 1) {
    const second = await football(`/players?${query}&page=2`, apiKey);
    players.push(...parsePlayerRows(second.body.response, teamName));
  }
  return players;
}

export const predictFixture = createServerFn({ method: "POST" })
  .validator(
    (data: {
      apiKey: string;
      geminiKey: string;
      model: string;
      fdKey: string;
      fixture: FixtureRow;
    }) => {
      if (!data?.apiKey || !data?.geminiKey || !data?.fixture?.id) {
        throw new Error("Faltan las claves necesarias para consultar y analizar el partido.");
      }
      return data;
    },
  )
  .handler(async ({ data }) => {
    const { fixture } = data;
    const code = LEAGUE_CODE[fixture.leagueId];
    const warnings: string[] = [];
    let matches: FdMatch[];
    let formSource: string;
    if (code && data.fdKey.trim()) {
      try {
        matches = await finishedMatches(data.fdKey, code);
        formSource = "football-data.org, temporada en curso";
      } catch {
        matches = await recentApiMatches(data.apiKey, fixture);
        formSource = "API-Football, últimos 8 partidos";
        warnings.push("football-data.org no devolvió la forma de esta competición; se usaron los últimos partidos de cada equipo.");
      }
    } else {
      matches = await recentApiMatches(data.apiKey, fixture);
      formSource = "API-Football, últimos 8 partidos";
    }
    const brief = {
      match: `${fixture.home} vs ${fixture.away}`,
      league: `${fixture.country} · ${fixture.league}`,
      source: formSource,
      h2h: h2hFrom(matches, fixture.home, fixture.away),
      home: formFrom(matches, fixture.home),
      away: formFrom(matches, fixture.away),
    };

    const [homePlayersResult, awayPlayersResult] = await Promise.allSettled([
      loadTeamPlayerStats(data.apiKey, fixture, fixture.homeId, fixture.home),
      loadTeamPlayerStats(data.apiKey, fixture, fixture.awayId, fixture.away),
    ]);
    const players = [
      ...(homePlayersResult.status === "fulfilled" ? homePlayersResult.value : []),
      ...(awayPlayersResult.status === "fulfilled" ? awayPlayersResult.value : []),
    ];
    if (homePlayersResult.status === "rejected") {
      warnings.push(`No se pudieron consultar las estadísticas de jugadores de ${fixture.home}.`);
    }
    if (awayPlayersResult.status === "rejected") {
      warnings.push(`No se pudieron consultar las estadísticas de jugadores de ${fixture.away}.`);
    }
    const markets = buildMarketCandidates({
      homeTeam: fixture.home,
      awayTeam: fixture.away,
      homeForm: { played: brief.home.played, goalsFor: brief.home.gf, goalsAgainst: brief.home.ga },
      awayForm: { played: brief.away.played, goalsFor: brief.away.gf, goalsAgainst: brief.away.ga },
      players,
    });
    const marketContext = markets.map(({ id, title, selection, probability, evidence }) => ({
      id,
      title,
      selection,
      probability,
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
                  text: `Eres un analista de fútbol. Usa exclusivamente los datos recibidos. Devuelve pick (1|X|2), probs {home,draw,away} sumando 100, over25 (0-100), btts (0-100), confidence (0-100), reason (máximo 2 frases en español) y bestMarketIds (hasta 3 IDs elegidos literalmente de candidates). Elige los mercados con mejor respaldo estadístico, con variedad si hay evidencia suficiente. No inventes jugadores, mercados, datos ni IDs. Si los datos no bastan, devuelve una lista vacía. Las probabilidades de candidates son estimaciones, no cuotas ni garantías.\n${JSON.stringify({ brief, candidates: marketContext })}`,
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                pick: { type: "STRING", enum: ["1", "X", "2"] },
                probs: {
                  type: "OBJECT",
                  properties: {
                    home: { type: "NUMBER" },
                    draw: { type: "NUMBER" },
                    away: { type: "NUMBER" },
                  },
                  required: ["home", "draw", "away"],
                },
                over25: { type: "NUMBER" },
                btts: { type: "NUMBER" },
                confidence: { type: "NUMBER" },
                reason: { type: "STRING" },
                bestMarketIds: { type: "ARRAY", items: { type: "STRING" } },
              },
              required: ["pick", "probs", "over25", "btts", "confidence", "reason", "bestMarketIds"],
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
    return {
      prediction: parsed,
      brief,
      warnings,
    };
  });

async function finishedMatches(token: string, code: string) {
  const cached = fdCache.get(code);
  if (cached && cached.expiresAt > Date.now()) return cached.matches;
  const res = await fetch(`${FD}/competitions/${code}/matches?status=FINISHED`, {
    headers: { "X-Auth-Token": token },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = (await res.json()) as { message?: string; matches?: FdMatch[] };
  if (!res.ok) throw new Error(body.message || `football-data.org ${res.status}`);
  const matches = body.matches ?? [];
  fdCache.set(code, { matches, expiresAt: Date.now() + FD_CACHE_TTL_MS });
  return matches;
}

function parseApiFixtureHistory(value: unknown): FdMatch[] {
  if (!Array.isArray(value)) return [];
  const matches: FdMatch[] = [];
  for (const row of value) {
    if (!isRecord(row)) continue;
    const fixture = row.fixture;
    const teams = row.teams;
    const goals = row.goals;
    if (!isRecord(fixture) || !isRecord(teams) || !isRecord(goals)) continue;
    const home = teams.home;
    const away = teams.away;
    if (
      !isRecord(home) ||
      !isRecord(away) ||
      typeof fixture.date !== "string" ||
      typeof home.name !== "string" ||
      typeof away.name !== "string" ||
      typeof goals.home !== "number" ||
      typeof goals.away !== "number"
    ) {
      continue;
    }
    matches.push({
      utcDate: fixture.date,
      status: "FINISHED",
      homeTeam: { name: home.name, shortName: home.name },
      awayTeam: { name: away.name, shortName: away.name },
      score: { fullTime: { home: goals.home, away: goals.away } },
    });
  }
  return matches;
}

async function recentApiMatches(apiKey: string, fixture: FixtureRow): Promise<FdMatch[]> {
  const [home, away] = await Promise.all([
    football(`/fixtures?team=${fixture.homeId}&last=8`, apiKey),
    football(`/fixtures?team=${fixture.awayId}&last=8`, apiKey),
  ]);
  const unique = new Map<string, FdMatch>();
  for (const match of [
    ...parseApiFixtureHistory(home.body.response),
    ...parseApiFixtureHistory(away.body.response),
  ]) {
    const key = `${match.utcDate}|${match.homeTeam?.name}|${match.awayTeam?.name}`;
    unique.set(key, match);
  }
  return [...unique.values()];
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

function formFrom(matches: FdMatch[], team: string) {
  const rows = matches
    .filter((m) => playedBy(m, team) && m.score?.fullTime?.home != null && m.score.fullTime.away != null)
    .sort((a, b) => (b.utcDate ?? "").localeCompare(a.utcDate ?? ""))
    .slice(0, 8);
  let w = 0;
  let d = 0;
  let l = 0;
  let gf = 0;
  let ga = 0;
  const lines = rows.map((m) => {
    const home = m.score?.fullTime?.home ?? 0;
    const away = m.score?.fullTime?.away ?? 0;
    const isHome = sameTeam(m.homeTeam?.name, team) || sameTeam(m.homeTeam?.shortName, team);
    const mine = isHome ? home : away;
    const opp = isHome ? away : home;
    gf += mine;
    ga += opp;
    if (mine > opp) w += 1;
    else if (mine === opp) d += 1;
    else l += 1;
    const tag = mine > opp ? "G" : mine === opp ? "E" : "P";
    return `${tag} ${m.homeTeam?.shortName ?? m.homeTeam?.name} ${home}-${away} ${m.awayTeam?.shortName ?? m.awayTeam?.name}`;
  });
  return { played: lines.length, w, d, l, gf, ga, matches: lines };
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
