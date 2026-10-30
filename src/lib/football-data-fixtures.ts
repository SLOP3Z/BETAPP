export type FixtureRow = {
  id: number;
  date: string;
  leagueId: number;
  season: number;
  league: string;
  country: string;
  round: string;
  home: string;
  away: string;
  status: string;
};

const COMPETITION_ID_BY_CODE: Record<string, number> = {
  PL: 39,
  PD: 140,
  SA: 135,
  BL1: 78,
  FL1: 61,
  CL: 2,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseFootballDataFixture(value: unknown): FixtureRow | null {
  if (!isRecord(value)) return null;
  const competition = value.competition;
  const season = value.season;
  const home = value.homeTeam;
  const away = value.awayTeam;
  if (
    typeof value.id !== "number" ||
    typeof value.utcDate !== "string" ||
    !isRecord(competition) ||
    typeof competition.code !== "string" ||
    typeof competition.name !== "string" ||
    !isRecord(season) ||
    !isRecord(home) ||
    !isRecord(away) ||
    typeof home.name !== "string" ||
    typeof away.name !== "string"
  ) {
    return null;
  }
  const leagueId = COMPETITION_ID_BY_CODE[competition.code];
  if (!leagueId) return null;

  return {
    id: value.id,
    date: value.utcDate,
    leagueId,
    season:
      typeof season.startDate === "string"
        ? new Date(season.startDate).getUTCFullYear()
        : new Date(value.utcDate).getUTCFullYear(),
    league: competition.name,
    country: isRecord(value.area) && typeof value.area.name === "string" ? value.area.name : "Desconocido",
    round: typeof value.matchday === "number" ? `Jornada ${value.matchday}` : "",
    home: home.name,
    away: away.name,
    status: typeof value.status === "string" ? value.status : "",
  };
}