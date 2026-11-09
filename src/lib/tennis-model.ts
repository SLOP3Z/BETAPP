export type TennisTour = "atp" | "wta";
export type Surface = "hard" | "clay" | "grass";

/** Niveles de torneo (rankId de la API) que sigue la app. */
const ALLOWED_RANKS: Record<TennisTour, number[]> = {
  atp: [2, 3, 4, 5, 7], // ATP 250/500, Masters 1000, Grand Slam, Copa Davis, ATP Finals
  wta: [7], // solo WTA Finals
};

export function allowedRankIds(tour: TennisTour): number[] {
  return ALLOWED_RANKS[tour];
}

export function isAllowedTournament(tour: TennisTour, rankId: number | null): boolean {
  return rankId !== null && ALLOWED_RANKS[tour].includes(rankId);
}

export function tierLabel(tour: TennisTour, rankId: number): string {
  if (rankId === 2) return "ATP 250/500";
  if (rankId === 3) return "Masters 1000";
  if (rankId === 4) return "Grand Slam";
  if (rankId === 5) return "Copa Davis";
  if (rankId === 7) return tour === "wta" ? "WTA Finals" : "ATP Finals";
  return "Otro";
}

const COURT_IDS: Record<string, number> = { hard: 1, clay: 2, "i.hard": 3, carpet: 4, grass: 5 };

export function surfaceFromCourt(
  courtId: number | null | undefined,
  courtName?: string | null,
): Surface | null {
  let id = courtId ?? null;
  if (id === null && courtName) id = COURT_IDS[courtName.trim().toLowerCase()] ?? null;
  if (id === 2) return "clay";
  if (id === 5) return "grass";
  if (id === 1 || id === 3 || id === 4) return "hard";
  return null;
}

export function surfaceLabel(surface: Surface | null): string {
  if (surface === "clay") return "tierra batida";
  if (surface === "grass") return "hierba";
  if (surface === "hard") return "pista dura";
  return "superficie desconocida";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

// ───────────── Partidos próximos ─────────────

export type TennisPlayerRef = {
  id: number;
  name: string;
  seed: string | null;
};

export type TennisFixture = {
  id: string;
  tour: TennisTour;
  date: string | null;
  tournament: { id: number; name: string; rankId: number; surface: Surface | null };
  roundName: string | null;
  player1: TennisPlayerRef;
  player2: TennisPlayerRef;
  h2h: { matches: number; player1Wins: number; player2Wins: number } | null;
  odds: { player1: number | null; player2: number | null } | null;
  bestOf: 3 | 5;
};

function parseOdds(
  match: Record<string, unknown>,
  p1: Record<string, unknown>,
  p2: Record<string, unknown>,
  p1Id: number,
  p2Id: number,
): TennisFixture["odds"] {
  const odds = match.odds;
  if (isRecord(odds)) {
    const k1 = num(odds.k1);
    const k2 = num(odds.k2);
    const id1 = num(odds.id1_o);
    if (k1 !== null && k2 !== null && k1 > 1 && k2 > 1) {
      // La API puede listar el par al revés: se asigna por id, no por posición.
      if (id1 === p2Id) return { player1: k2, player2: k1 };
      if (id1 === p1Id || id1 === null) return { player1: k1, player2: k2 };
    }
  }
  const o1 = num(p1.odd);
  const o2 = num(p2.odd);
  if (o1 !== null && o2 !== null && o1 > 1 && o2 > 1) return { player1: o1, player2: o2 };
  return null;
}

export function parseUpcomingMatches(body: unknown, tour: TennisTour): TennisFixture[] {
  const rows = isRecord(body) && Array.isArray(body.matches) ? body.matches : [];
  const fixtures: TennisFixture[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const t = isRecord(row.tournament) ? row.tournament : {};
    const rankId = num(t.rankId) ?? num(row.rank);
    if (!isAllowedTournament(tour, rankId) || rankId === null) continue;

    const p1 = isRecord(row.player1) ? row.player1 : null;
    const p2 = isRecord(row.player2) ? row.player2 : null;
    if (!p1 || !p2) continue;
    if (Array.isArray(p1.members) || Array.isArray(p2.members)) continue; // dobles
    if (row.isBye === true || row.awaitingParticipants === true) continue;
    const p1Id = num(p1.id);
    const p2Id = num(p2.id);
    const p1Name = typeof p1.name === "string" ? p1.name.trim() : "";
    const p2Name = typeof p2.name === "string" ? p2.name.trim() : "";
    if (p1Id === null || p2Id === null || !p1Name || !p2Name) continue;
    if (/unknown player|^tbd$/i.test(p1Name) || /unknown player|^tbd$/i.test(p2Name)) continue;

    const court = isRecord(t.court) ? t.court : null;
    const surface = surfaceFromCourt(
      num(t.courtId) ?? (court ? num(court.id) : null),
      (court && typeof court.name === "string" ? court.name : null) ??
        (typeof row.court === "string" ? row.court : null),
    );
    const roundId = num(row.roundId);
    const round = isRecord(row.round) && typeof row.round.name === "string" ? row.round.name : null;
    const summary = isRecord(row.h2hSummary) ? row.h2hSummary : null;
    const matches = summary ? num(summary.matchCount) : null;
    const w1 = summary ? num(summary.player1Wins) : null;
    const w2 = summary ? num(summary.player2Wins) : null;
    const id =
      typeof row.liveMatchId === "string" && row.liveMatchId
        ? row.liveMatchId
        : `${p1Id}-${p2Id}-${num(t.id) ?? 0}-${roundId ?? 0}`;

    fixtures.push({
      id,
      tour,
      date: typeof row.date === "string" ? row.date : null,
      tournament: {
        id: num(t.id) ?? 0,
        name: typeof t.name === "string" ? t.name : "Torneo",
        rankId,
        surface,
      },
      roundName: round,
      player1: { id: p1Id, name: p1Name, seed: typeof p1.seed === "string" ? p1.seed : null },
      player2: { id: p2Id, name: p2Name, seed: typeof p2.seed === "string" ? p2.seed : null },
      h2h:
        matches !== null && w1 !== null && w2 !== null
          ? { matches, player1Wins: w1, player2Wins: w2 }
          : null,
      odds: parseOdds(row, p1, p2, p1Id, p2Id),
      // Solo los Grand Slam masculinos se juegan al mejor de cinco sets.
      bestOf: tour === "atp" && rankId === 4 ? 5 : 3,
    });
  }
  return fixtures.sort((a, b) => (a.date ?? "9").localeCompare(b.date ?? "9"));
}

// ───────────── Resultados pasados ─────────────

export type PlayedMatch = {
  date: string;
  won: boolean;
  surface: Surface | null;
  games: { for: number; against: number } | null;
  sets: { for: number; against: number } | null;
};

/** "6-3 6-7(7) 7-5": juegos y sets del ganador y del perdedor. null si no es un resultado completo. */
export function parseScore(
  result: string,
  resultType?: string,
): { winnerGames: number; loserGames: number; winnerSets: number; loserSets: number } | null {
  if (resultType && resultType !== "completed") return null;
  const tokens = result.trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return null;
  let winnerGames = 0;
  let loserGames = 0;
  let winnerSets = 0;
  let loserSets = 0;
  for (const token of tokens) {
    const match = /^(\d+)-(\d+)(?:\(\d+\))?$/.exec(token);
    if (!match) return null;
    const a = Number(match[1]);
    const b = Number(match[2]);
    winnerGames += a;
    loserGames += b;
    if (a > b) winnerSets += 1;
    else if (b > a) loserSets += 1;
  }
  if (winnerSets <= loserSets) return null;
  return { winnerGames, loserGames, winnerSets, loserSets };
}

export function parsePastMatches(body: unknown, playerId: number): PlayedMatch[] {
  const rows = isRecord(body) && Array.isArray(body.data) ? body.data : [];
  const matches: PlayedMatch[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const winnerId = num(row.player1Id) ?? (isRecord(row.player1) ? num(row.player1.id) : null);
    const loserId = num(row.player2Id) ?? (isRecord(row.player2) ? num(row.player2.id) : null);
    if (winnerId === null || loserId === null) continue;
    if (winnerId !== playerId && loserId !== playerId) continue;
    if (isRecord(row.player1) && Array.isArray(row.player1.members)) continue; // dobles
    const date = typeof row.date === "string" ? row.date : "";
    if (!date) continue;
    const won = winnerId === playerId;
    const t = isRecord(row.tournament) ? row.tournament : {};
    const court = isRecord(t.court) ? t.court : null;
    const surface = surfaceFromCourt(
      num(t.courtId) ?? (court ? num(court.id) : null),
      court && typeof court.name === "string" ? court.name : null,
    );
    const score =
      typeof row.result === "string"
        ? parseScore(row.result, typeof row.result_type === "string" ? row.result_type : undefined)
        : null;
    matches.push({
      date,
      won,
      surface,
      games: score
        ? won
          ? { for: score.winnerGames, against: score.loserGames }
          : { for: score.loserGames, against: score.winnerGames }
        : null,
      sets: score
        ? won
          ? { for: score.winnerSets, against: score.loserSets }
          : { for: score.loserSets, against: score.winnerSets }
        : null,
    });
  }
  return matches.sort((a, b) => b.date.localeCompare(a.date));
}

// ───────────── Forma ─────────────

export type PlayerForm = {
  recent: { wins: number; played: number };
  surface: { wins: number; played: number };
  gamesPerSet: number | null;
  setsSample: number;
  lastResults: string[];
};

const RECENT_MATCHES = 10;
const SURFACE_MATCHES = 15;

export function buildPlayerForm(matches: PlayedMatch[], surface: Surface | null): PlayerForm {
  const sorted = [...matches].sort((a, b) => b.date.localeCompare(a.date));
  const recent = sorted.slice(0, RECENT_MATCHES);
  const onSurface = surface ? sorted.filter((m) => m.surface === surface).slice(0, SURFACE_MATCHES) : [];
  let games = 0;
  let sets = 0;
  for (const m of sorted.slice(0, SURFACE_MATCHES)) {
    if (!m.games || !m.sets) continue;
    games += m.games.for + m.games.against;
    sets += m.sets.for + m.sets.against;
  }
  return {
    recent: { wins: recent.filter((m) => m.won).length, played: recent.length },
    surface: { wins: onSurface.filter((m) => m.won).length, played: onSurface.length },
    gamesPerSet: sets > 0 ? games / sets : null,
    setsSample: sets,
    lastResults: sorted.slice(0, 5).map((m) => (m.won ? "G" : "P")),
  };
}

// ───────────── Probabilidad de victoria ─────────────

function logit(p: number): number {
  return Math.log(p / (1 - p));
}

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

function shrunk(wins: number, played: number): number {
  return (wins + 2) / (played + 4);
}

export type H2HRecord = { matches: number; player1Wins: number; player2Wins: number };

export function formWinProbability(
  form1: PlayerForm,
  form2: PlayerForm,
  h2h: H2HRecord | null,
): number {
  const surface = logit(shrunk(form1.surface.wins, form1.surface.played)) -
    logit(shrunk(form2.surface.wins, form2.surface.played));
  const recent = logit(shrunk(form1.recent.wins, form1.recent.played)) -
    logit(shrunk(form2.recent.wins, form2.recent.played));
  const meetings = h2h ? (h2h.player1Wins + 1) / (h2h.player1Wins + h2h.player2Wins + 2) : 0.5;
  const z = 1.1 * surface + 0.9 * recent + 0.6 * logit(meetings);
  return Math.min(0.92, Math.max(0.08, sigmoid(z)));
}

/** Probabilidad implícita del jugador 1 según las cuotas, sin el margen de la casa. */
export function marketProbability(odds: TennisFixture["odds"]): number | null {
  if (!odds || odds.player1 === null || odds.player2 === null) return null;
  const a = 1 / odds.player1;
  const b = 1 / odds.player2;
  return a / (a + b);
}

const MARKET_WEIGHT = 0.6;

export function blendedWinProbability(form: number, market: number | null): number {
  return market === null ? form : MARKET_WEIGHT * market + (1 - MARKET_WEIGHT) * form;
}

// ───────────── Sets y juegos ─────────────

function matchWinGivenSet(q: number, bestOf: 3 | 5): number {
  return bestOf === 3 ? q * q * (3 - 2 * q) : q ** 3 * (10 - 15 * q + 6 * q * q);
}

/** Probabilidad de ganar un set que corresponde a una probabilidad de ganar el partido. */
export function setWinProbability(matchWin: number, bestOf: 3 | 5): number {
  let low = 0;
  let high = 1;
  for (let i = 0; i < 60; i += 1) {
    const mid = (low + high) / 2;
    if (matchWinGivenSet(mid, bestOf) < matchWin) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

export function setCountDistribution(q: number, bestOf: 3 | 5): Map<number, number> {
  const p = q;
  const r = 1 - q;
  if (bestOf === 3) {
    const two = p * p + r * r;
    return new Map([[2, two], [3, 1 - two]]);
  }
  const three = p ** 3 + r ** 3;
  const four = 3 * p ** 3 * r + 3 * p * r ** 3;
  return new Map([[3, three], [4, four], [5, 1 - three - four]]);
}

const SET_TOTALS = [6, 7, 8, 9, 10, 12, 13];
const SET_BASE = [0.05, 0.12, 0.18, 0.2, 0.18, 0.12, 0.15];
const DEFAULT_GAMES_PER_SET = 9.57;

function setDistribution(targetMean: number): number[] {
  const tilt = (lambda: number): number[] => {
    const weights = SET_BASE.map((p, i) => p * Math.exp(lambda * (SET_TOTALS[i] ?? 0)));
    const sum = weights.reduce((acc, w) => acc + w, 0);
    return weights.map((w) => w / sum);
  };
  const mean = (dist: number[]) => dist.reduce((acc, p, i) => acc + p * (SET_TOTALS[i] ?? 0), 0);
  let low = -2;
  let high = 2;
  for (let i = 0; i < 50; i += 1) {
    const mid = (low + high) / 2;
    if (mean(tilt(mid)) < targetMean) low = mid;
    else high = mid;
  }
  return tilt((low + high) / 2);
}

function convolve(a: Map<number, number>, dist: number[]): Map<number, number> {
  const out = new Map<number, number>();
  for (const [total, p] of a) {
    dist.forEach((q, i) => {
      const key = total + (SET_TOTALS[i] ?? 0);
      out.set(key, (out.get(key) ?? 0) + p * q);
    });
  }
  return out;
}

export function totalGamesDistribution(
  matchWin: number,
  bestOf: 3 | 5,
  gamesPerSet: number,
): Map<number, number> {
  const q = setWinProbability(matchWin, bestOf);
  const setCounts = setCountDistribution(q, bestOf);
  const dist = setDistribution(Math.min(11.5, Math.max(8, gamesPerSet)));
  const result = new Map<number, number>();
  for (const [sets, probability] of setCounts) {
    let total = new Map<number, number>([[0, 1]]);
    for (let i = 0; i < sets; i += 1) total = convolve(total, dist);
    for (const [games, p] of total) {
      result.set(games, (result.get(games) ?? 0) + p * probability);
    }
  }
  return result;
}

export function overProbability(distribution: Map<number, number>, line: number): number {
  let over = 0;
  for (const [games, p] of distribution) if (games > line) over += p;
  return over;
}

export function expectedValue(distribution: Map<number, number>): number {
  let mean = 0;
  for (const [games, p] of distribution) mean += games * p;
  return mean;
}

export function blendedGamesPerSet(form1: PlayerForm, form2: PlayerForm): number {
  const PRIOR_SETS = 6;
  let weighted = DEFAULT_GAMES_PER_SET * PRIOR_SETS;
  let weight = PRIOR_SETS;
  for (const form of [form1, form2]) {
    if (form.gamesPerSet !== null) {
      weighted += form.gamesPerSet * form.setsSample;
      weight += form.setsSample;
    }
  }
  return weighted / weight;
}

// ───────────── Opciones recomendadas ─────────────

export type TennisCandidate = {
  id: string;
  market: "winner" | "games" | "sets";
  title: string;
  selection: string;
  probability: number;
  evidence: string;
  sampleSize: number;
  odds: number | null;
};

export type TennisAnalysis = {
  player1WinProbability: number;
  formProbability: number;
  marketProbability: number | null;
  expectedGames: number;
  gamesPerSet: number;
  form1: PlayerForm;
  form2: PlayerForm;
  surfaceH2H: H2HRecord | null;
  candidates: TennisCandidate[];
};

const MIN_PROBABILITY = 55;
const MAX_PROBABILITY = 85;
const WINNER_MIN_PROBABILITY = 52;

function formText(name: string, form: PlayerForm, surface: Surface | null): string {
  const parts = [`${name} ganó ${form.recent.wins} de sus últimos ${form.recent.played} partidos de circuito`];
  if (form.surface.played > 0 && surface) {
    parts.push(`y ${form.surface.wins} de ${form.surface.played} en ${surfaceLabel(surface)}`);
  }
  return parts.join(" ");
}

export function analyzeMatch(
  fixture: TennisFixture,
  matches1: PlayedMatch[],
  matches2: PlayedMatch[],
  surfaceH2H: H2HRecord | null,
): TennisAnalysis {
  const surface = fixture.tournament.surface;
  const form1 = buildPlayerForm(matches1, surface);
  const form2 = buildPlayerForm(matches2, surface);
  const h2h: H2HRecord | null =
    surfaceH2H && surfaceH2H.matches >= 2 ? surfaceH2H : fixture.h2h;
  const formP = formWinProbability(form1, form2, h2h);
  const marketP = marketProbability(fixture.odds);
  const p1 = blendedWinProbability(formP, marketP);
  const gps = blendedGamesPerSet(form1, form2);
  const bestOf = fixture.bestOf;
  const distribution = totalGamesDistribution(p1, bestOf, gps);
  const expectedGames = expectedValue(distribution);
  const q = setWinProbability(p1, bestOf);
  const straight1 = bestOf === 3 ? q * q : q ** 3;
  const straight2 = bestOf === 3 ? (1 - q) ** 2 : (1 - q) ** 3;

  const candidates: TennisCandidate[] = [];
  const add = (c: Omit<TennisCandidate, "probability"> & { probability: number }) => {
    const probability = Math.round(c.probability * 100);
    const min = c.market === "winner" ? WINNER_MIN_PROBABILITY : MIN_PROBABILITY;
    if (probability >= min && probability <= MAX_PROBABILITY) candidates.push({ ...c, probability });
  };

  const h2hText = h2h && h2h.matches > 0
    ? ` Cara a cara: ${h2h.player1Wins}-${h2h.player2Wins}.`
    : " No han jugado antes entre ellos.";
  const marketText = (odds: number | null, probability: number) =>
    odds !== null
      ? ` Cuota ${odds.toLocaleString("es", { minimumFractionDigits: 2 })} (${
          probability * odds - 1 >= 0 ? "con valor" : "sin valor"
        } según esta estimación).`
      : "";
  const sample = (f: PlayerForm) => f.recent.played;

  add({
    id: "winner-1",
    market: "winner",
    title: "Ganador del partido",
    selection: `Gana ${fixture.player1.name}`,
    probability: p1,
    evidence: `${formText(fixture.player1.name, form1, surface)}, frente a ${form2.recent.wins} de ${form2.recent.played} de ${fixture.player2.name}.${h2hText}${marketText(fixture.odds?.player1 ?? null, p1)}`,
    sampleSize: Math.min(sample(form1), sample(form2)),
    odds: fixture.odds?.player1 ?? null,
  });
  add({
    id: "winner-2",
    market: "winner",
    title: "Ganador del partido",
    selection: `Gana ${fixture.player2.name}`,
    probability: 1 - p1,
    evidence: `${formText(fixture.player2.name, form2, surface)}, frente a ${form1.recent.wins} de ${form1.recent.played} de ${fixture.player1.name}.${h2hText}${marketText(fixture.odds?.player2 ?? null, 1 - p1)}`,
    sampleSize: Math.min(sample(form1), sample(form2)),
    odds: fixture.odds?.player2 ?? null,
  });

  const gamesEvidence = `Se esperan unos ${expectedGames.toFixed(1)} juegos al mejor de ${bestOf} sets, con ${gps.toFixed(1)} juegos por set entre los dos.`;
  const gamesSample = Math.min(sample(form1), sample(form2));
  const center = Math.floor(expectedGames) + 0.5;
  for (const line of [center - 3, center - 2, center - 1, center, center + 1, center + 2, center + 3]) {
    const over = overProbability(distribution, line);
    add({
      id: `games-over-${line}`,
      market: "games",
      title: "Total de juegos",
      selection: `Más de ${line.toLocaleString("es")} juegos`,
      probability: over,
      evidence: gamesEvidence,
      sampleSize: gamesSample,
      odds: null,
    });
    add({
      id: `games-under-${line}`,
      market: "games",
      title: "Total de juegos",
      selection: `Menos de ${line.toLocaleString("es")} juegos`,
      probability: 1 - over,
      evidence: gamesEvidence,
      sampleSize: gamesSample,
      odds: null,
    });
  }

  const favorite = p1 >= 0.5 ? fixture.player1.name : fixture.player2.name;
  add({
    id: "straight-sets",
    market: "sets",
    title: "Resultado en sets",
    selection: `${favorite} gana sin ceder un set`,
    probability: p1 >= 0.5 ? straight1 : straight2,
    evidence: `Con una probabilidad de victoria de ${Math.round(Math.max(p1, 1 - p1) * 100)} %, se estima que ganaría los ${bestOf === 3 ? "dos" : "tres"} primeros sets.`,
    sampleSize: gamesSample,
    odds: null,
  });

  return {
    player1WinProbability: p1,
    formProbability: formP,
    marketProbability: marketP,
    expectedGames,
    gamesPerSet: gps,
    form1,
    form2,
    surfaceH2H,
    candidates: candidates.sort((a, b) => b.probability - a.probability),
  };
}

/** La mejor opción y hasta dos alternativas, una por mercado. */
export function bestTennisPicks(candidates: TennisCandidate[]): TennisCandidate[] {
  const picks: TennisCandidate[] = [];
  const used = new Set<TennisCandidate["market"]>();
  for (const candidate of [...candidates].sort((a, b) => b.probability - a.probability)) {
    if (used.has(candidate.market)) continue;
    used.add(candidate.market);
    picks.push(candidate);
    if (picks.length === 3) break;
  }
  return picks;
}

// ───────────── Cara a cara por superficie y validación ─────────────

/** Respuesta de h2h/info: victorias de cada jugador en la superficie del partido. */
export function parseSurfaceH2H(body: unknown, surface: Surface | null): H2HRecord | null {
  if (!surface) return null;
  const rows = isRecord(body) && Array.isArray(body.data) ? body.data : [];
  let player1Wins = 0;
  let player2Wins = 0;
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const rowSurface = surfaceFromCourt(num(row.courtId), typeof row.court === "string" ? row.court : null);
    if (rowSurface !== surface) continue;
    player1Wins += num(row.player1wins) ?? 0;
    player2Wins += num(row.player2wins) ?? 0;
  }
  const matches = player1Wins + player2Wins;
  return matches > 0 ? { matches, player1Wins, player2Wins } : null;
}

/** Reconstruye un partido enviado por el navegador y descarta lo que no cuadra. */
export function sanitizeFixture(value: unknown): TennisFixture | null {
  if (!isRecord(value)) return null;
  const tour = value.tour === "atp" || value.tour === "wta" ? value.tour : null;
  const t = isRecord(value.tournament) ? value.tournament : null;
  const p1 = isRecord(value.player1) ? value.player1 : null;
  const p2 = isRecord(value.player2) ? value.player2 : null;
  if (!tour || !t || !p1 || !p2 || typeof value.id !== "string") return null;
  const rankId = num(t.rankId);
  const p1Id = num(p1.id);
  const p2Id = num(p2.id);
  if (!isAllowedTournament(tour, rankId) || rankId === null || p1Id === null || p2Id === null) return null;
  if (typeof p1.name !== "string" || typeof p2.name !== "string") return null;
  const surface = t.surface === "hard" || t.surface === "clay" || t.surface === "grass" ? t.surface : null;
  const h2h = isRecord(value.h2h) ? value.h2h : null;
  const odds = isRecord(value.odds) ? value.odds : null;
  const o1 = odds ? num(odds.player1) : null;
  const o2 = odds ? num(odds.player2) : null;
  return {
    id: value.id,
    tour,
    date: typeof value.date === "string" ? value.date : null,
    tournament: { id: num(t.id) ?? 0, name: typeof t.name === "string" ? t.name : "Torneo", rankId, surface },
    roundName: typeof value.roundName === "string" ? value.roundName : null,
    player1: { id: p1Id, name: p1.name, seed: typeof p1.seed === "string" ? p1.seed : null },
    player2: { id: p2Id, name: p2.name, seed: typeof p2.seed === "string" ? p2.seed : null },
    h2h:
      h2h && num(h2h.matches) !== null && num(h2h.player1Wins) !== null && num(h2h.player2Wins) !== null
        ? { matches: num(h2h.matches) ?? 0, player1Wins: num(h2h.player1Wins) ?? 0, player2Wins: num(h2h.player2Wins) ?? 0 }
        : null,
    odds: o1 !== null && o2 !== null && o1 > 1 && o2 > 1 ? { player1: o1, player2: o2 } : null,
    bestOf: tour === "atp" && rankId === 4 ? 5 : 3,
  };
}
