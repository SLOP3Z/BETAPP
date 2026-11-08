import {
  poissonOverProbability,
  teamExpectedGoals,
  type TeamGoalForm,
} from "./football-markets.ts";

/** Partido terminado con marcador, tal como llega de football-data.org. */
export type FinishedScore = {
  score?: { fullTime?: { home?: number | null; away?: number | null } };
};

export type LeagueAverages = {
  matches: number;
  goals: number;
  over15: number;
  over25: number;
  btts: number;
};

export type MatchAnalysis = {
  generatedAt: string;
  /** Porcentajes enteros que suman 100, o null si falta muestra. */
  result: { home: number; draw: number; away: number } | null;
  expectedGoals: { home: number; away: number; total: number } | null;
  /** Porcentajes enteros. */
  keyProbabilities: { over15: number; over25: number; btts: number } | null;
  leagueAverages: LeagueAverages | null;
  /** Últimos 5 partidos de cada equipo, el más reciente primero: G, E o P. */
  form: { home: string[]; away: string[] };
  /** Últimos 5 partidos de cada equipo, sin la letra de resultado. */
  lastMatches: { home: string[]; away: string[] };
};

type BuildAnalysisOptions = {
  homeForm: TeamGoalForm;
  awayForm: TeamGoalForm;
  minVenueMatches: number;
  competitionMatches: FinishedScore[];
  homeRecentLines: string[];
  awayRecentLines: string[];
  now?: Date;
};

const MIN_LEAGUE_SAMPLE = 20;

function percent(value: number): number {
  return Math.round(value * 100);
}

/** Mismos cálculos que usa buildMarketCandidates, para que no se contradigan. */
export function resultProbabilities(homeForm: TeamGoalForm, awayForm: TeamGoalForm) {
  const homeWin = (homeForm.wins / homeForm.played + awayForm.losses / awayForm.played) / 2;
  const draw = (homeForm.draws / homeForm.played + awayForm.draws / awayForm.played) / 2;
  const awayWin = (homeForm.losses / homeForm.played + awayForm.wins / awayForm.played) / 2;
  const total = homeWin + draw + awayWin;
  if (total <= 0) return null;
  return { home: homeWin / total, draw: draw / total, away: awayWin / total };
}

/** Redondea a enteros que suman exactamente 100. */
function roundToHundred(values: number[]): number[] {
  const floors = values.map((v) => Math.floor(v * 100));
  let missing = 100 - floors.reduce((sum, v) => sum + v, 0);
  const order = values
    .map((v, index) => ({ index, rest: v * 100 - Math.floor(v * 100) }))
    .sort((a, b) => b.rest - a.rest);
  for (const { index } of order) {
    if (missing <= 0) break;
    floors[index] += 1;
    missing -= 1;
  }
  return floors;
}

export function leagueAveragesFrom(matches: FinishedScore[]): LeagueAverages | null {
  let played = 0;
  let goals = 0;
  let over15 = 0;
  let over25 = 0;
  let btts = 0;
  for (const match of matches) {
    const home = match.score?.fullTime?.home;
    const away = match.score?.fullTime?.away;
    if (home == null || away == null) continue;
    played += 1;
    goals += home + away;
    if (home + away > 1.5) over15 += 1;
    if (home + away > 2.5) over25 += 1;
    if (home > 0 && away > 0) btts += 1;
  }
  if (played < MIN_LEAGUE_SAMPLE) return null;
  return {
    matches: played,
    goals: Math.round((goals / played) * 100) / 100,
    over15: Math.round((over15 / played) * 1000) / 10,
    over25: Math.round((over25 / played) * 1000) / 10,
    btts: Math.round((btts / played) * 1000) / 10,
  };
}

function tagsFrom(lines: string[]): string[] {
  return lines.slice(0, 5).map((line) => line.charAt(0)).filter((tag) => "GEP".includes(tag));
}

function matchTextsFrom(lines: string[]): string[] {
  return lines.slice(0, 5).map((line) => line.slice(2).trim());
}

export function buildMatchAnalysis({
  homeForm,
  awayForm,
  minVenueMatches,
  competitionMatches,
  homeRecentLines,
  awayRecentLines,
  now = new Date(),
}: BuildAnalysisOptions): MatchAnalysis {
  const hasVenueSample =
    homeForm.played >= minVenueMatches && awayForm.played >= minVenueMatches;

  let result: MatchAnalysis["result"] = null;
  let keyProbabilities: MatchAnalysis["keyProbabilities"] = null;
  let expectedGoals: MatchAnalysis["expectedGoals"] = null;

  if (hasVenueSample) {
    const raw = resultProbabilities(homeForm, awayForm);
    if (raw) {
      const [home, draw, away] = roundToHundred([raw.home, raw.draw, raw.away]);
      result = { home, draw, away };
    }
    const bttsRate =
      (homeForm.bothScored / homeForm.played + awayForm.bothScored / awayForm.played) / 2;
    const homeMean = teamExpectedGoals(homeForm, awayForm, minVenueMatches);
    const awayMean = teamExpectedGoals(awayForm, homeForm, minVenueMatches);
    if (homeMean !== null && awayMean !== null) {
      const total = homeMean + awayMean;
      expectedGoals = {
        home: Math.round(homeMean * 100) / 100,
        away: Math.round(awayMean * 100) / 100,
        total: Math.round(total * 100) / 100,
      };
      keyProbabilities = {
        over15: percent(poissonOverProbability(total, 1.5)),
        over25: percent(poissonOverProbability(total, 2.5)),
        btts: percent(bttsRate),
      };
    }
  }

  return {
    generatedAt: now.toISOString(),
    result,
    expectedGoals,
    keyProbabilities,
    leagueAverages: leagueAveragesFrom(competitionMatches),
    form: { home: tagsFrom(homeRecentLines), away: tagsFrom(awayRecentLines) },
    lastMatches: {
      home: matchTextsFrom(homeRecentLines),
      away: matchTextsFrom(awayRecentLines),
    },
  };
}

/** Valida lo guardado en localStorage antes de pintarlo. */
export function parseStoredAnalysis(value: unknown): MatchAnalysis | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const v = value as Record<string, unknown>;
  const form = v.form as { home?: unknown; away?: unknown } | undefined;
  const last = v.lastMatches as { home?: unknown; away?: unknown } | undefined;
  if (!form || !Array.isArray(form.home) || !Array.isArray(form.away)) return undefined;
  if (!last || !Array.isArray(last.home) || !Array.isArray(last.away)) return undefined;
  if (typeof v.generatedAt !== "string") return undefined;
  return value as MatchAnalysis;
}
