import { createServerFn } from "@tanstack/react-start";
import {
  allowedRankIds,
  analyzeMatch,
  bestTennisPicks,
  parsePastMatches,
  parseSurfaceH2H,
  parseUpcomingMatches,
  sanitizeFixture,
  type H2HRecord,
  type PlayedMatch,
  type TennisFixture,
  type TennisTour,
} from "./tennis-model";

const HOST = "tennis-api-atp-wta-itf.p.rapidapi.com";
const REQUEST_TIMEOUT_MS = 30_000;
const FIXTURES_TTL_MS = 30 * 60 * 1000;
const FORM_TTL_MS = 6 * 60 * 60 * 1000;
const H2H_TTL_MS = 24 * 60 * 60 * 1000;
const MIN_MEETINGS_FOR_SURFACE_H2H = 3;
const TOUR_LEVEL_FILTER = "PlayerGroup:singles;TourRank:2,3,4,5,7";

export type TennisQuota = { remaining: number | null; limit: number | null };

type CacheEntry = { expiresAt: number; value: unknown };
const cache = new Map<string, CacheEntry>();

function cached<T>(key: string): T | null {
  const entry = cache.get(key);
  return entry && entry.expiresAt > Date.now() ? (entry.value as T) : null;
}

function remember(key: string, value: unknown, ttl: number): void {
  cache.set(key, { value, expiresAt: Date.now() + ttl });
}

function headerNumber(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

async function rapidGet(
  key: string,
  path: string,
  params: Record<string, string> = {},
): Promise<{ body: unknown; quota: TennisQuota }> {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`https://${HOST}${path}${query ? `?${query}` : ""}`, {
    headers: { "X-RapidAPI-Key": key, "X-RapidAPI-Host": HOST },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const quota: TennisQuota = {
    remaining: headerNumber(res.headers, "x-ratelimit-requests-remaining"),
    limit: headerNumber(res.headers, "x-ratelimit-requests-limit"),
  };
  const body: unknown = await res.json().catch(() => null);
  if (res.status === 429) {
    throw new Error(
      "Se ha superado el límite de la API de tenis (50 peticiones al día o 4 por segundo en el plan gratuito). Inténtalo más tarde.",
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new Error("La clave de RapidAPI no es válida o no estás suscrito a Tennis API.");
  }
  if (!res.ok) {
    const message =
      typeof body === "object" && body !== null && "message" in body && typeof body.message === "string"
        ? body.message
        : `Tennis API ${res.status}`;
    throw new Error(message);
  }
  return { body, quota };
}

function assertKey(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Falta la clave de RapidAPI.");
  return value.trim();
}

export const loadTennisFixtures = createServerFn({ method: "POST" })
  .validator((data: { rapidKey: string; date: string }) => {
    assertKey(data?.rapidKey);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date ?? "")) throw new Error("Fecha no válida.");
    return data;
  })
  .handler(async ({ data }) => {
    const key = assertKey(data.rapidKey);
    const cacheKey = `fixtures:${data.date}`;
    const hit = cached<{ fixtures: TennisFixture[] }>(cacheKey);
    if (hit) return { fixtures: hit.fixtures, quota: null as TennisQuota | null, note: "" };

    const fixtures: TennisFixture[] = [];
    let quota: TennisQuota | null = null;
    let note = "";
    for (const tour of ["atp", "wta"] as TennisTour[]) {
      try {
        const result = await rapidGet(key, `/tennis/v2/upcoming/matches/${tour}`, {
          dateOnly: data.date,
          rank: allowedRankIds(tour).join(","),
          group: "singles",
          include: "all,fixtureDetails",
          limit: "100",
        });
        quota = result.quota;
        fixtures.push(...parseUpcomingMatches(result.body, tour));
      } catch (error) {
        // Si falla el ATP se avisa; un fallo del WTA no impide ver el ATP.
        if (tour === "atp") throw error;
        note = `No se pudo consultar el WTA Finals: ${error instanceof Error ? error.message : "error desconocido"}`;
      }
    }
    fixtures.sort((a, b) => (a.date ?? "9").localeCompare(b.date ?? "9"));
    remember(cacheKey, { fixtures }, FIXTURES_TTL_MS);
    return { fixtures, quota, note };
  });

async function playerMatches(key: string, tour: TennisTour, playerId: number) {
  const cacheKey = `form:${tour}:${playerId}`;
  const hit = cached<PlayedMatch[]>(cacheKey);
  if (hit) return { matches: hit, quota: null as TennisQuota | null };
  const result = await rapidGet(key, `/tennis/v2/${tour}/player/past-matches/${playerId}`, {
    include: "tournament.court",
    filter: TOUR_LEVEL_FILTER,
    pageSize: "30",
  });
  const matches = parsePastMatches(result.body, playerId);
  remember(cacheKey, matches, FORM_TTL_MS);
  return { matches, quota: result.quota };
}

export const predictTennisMatch = createServerFn({ method: "POST" })
  .validator((data: { rapidKey: string; fixture: unknown }) => {
    const rapidKey = assertKey(data?.rapidKey);
    const fixture = sanitizeFixture(data.fixture);
    if (!fixture) throw new Error("El partido no es válido.");
    return { rapidKey, fixture };
  })
  .handler(async ({ data }) => {
    const { rapidKey, fixture } = data;
    let quota: TennisQuota | null = null;

    const first = await playerMatches(rapidKey, fixture.tour, fixture.player1.id);
    quota = first.quota ?? quota;
    const second = await playerMatches(rapidKey, fixture.tour, fixture.player2.id);
    quota = second.quota ?? quota;

    // El cara a cara por superficie cuesta una petición más: solo si hay historial suficiente.
    let surfaceH2H: H2HRecord | null = null;
    if (fixture.h2h && fixture.h2h.matches >= MIN_MEETINGS_FOR_SURFACE_H2H && fixture.tournament.surface) {
      const cacheKey = `h2h:${fixture.tour}:${fixture.player1.id}:${fixture.player2.id}:${fixture.tournament.surface}`;
      const hit = cached<H2HRecord | null>(cacheKey);
      if (hit !== null) {
        surfaceH2H = hit;
      } else {
        const result = await rapidGet(
          rapidKey,
          `/tennis/v2/${fixture.tour}/h2h/info/${fixture.player1.id}/${fixture.player2.id}`,
        );
        quota = result.quota;
        surfaceH2H = parseSurfaceH2H(result.body, fixture.tournament.surface);
        if (surfaceH2H) remember(cacheKey, surfaceH2H, H2H_TTL_MS);
      }
    }

    const analysis = analyzeMatch(fixture, first.matches, second.matches, surfaceH2H);
    const picks = bestTennisPicks(analysis.candidates);
    return {
      picks,
      summary: {
        player1Win: Math.round(analysis.player1WinProbability * 100),
        market: analysis.marketProbability === null ? null : Math.round(analysis.marketProbability * 100),
        expectedGames: Math.round(analysis.expectedGames * 10) / 10,
        form1: analysis.form1,
        form2: analysis.form2,
        surfaceH2H: analysis.surfaceH2H,
        matchesFound: { player1: first.matches.length, player2: second.matches.length },
      },
      quota,
    };
  });
