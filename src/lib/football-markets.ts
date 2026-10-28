export type PlayerSeasonStats = {
  id: number;
  name: string;
  team: string;
  appearances: number;
  goals?: number;
  shots?: number;
  shotsOnTarget?: number;
  foulsCommitted?: number;
  foulsDrawn?: number;
  yellowCards?: number;
};

export type TeamGoalForm = {
  played: number;
  goalsFor: number;
  goalsAgainst: number;
};

export type MarketCandidate = {
  id: string;
  category: "match-goals" | "team-goals" | "player";
  title: string;
  selection: string;
  probability: number;
  evidence: string;
  sampleSize: number;
};

type BuildMarketOptions = {
  homeTeam: string;
  awayTeam: string;
  homeForm: TeamGoalForm;
  awayForm: TeamGoalForm;
  players: PlayerSeasonStats[];
};

const GOAL_LINES = [0.5, 1.5, 2.5, 3.5, 4.5];
const PLAYER_LINES = [0.5, 1.5, 2.5, 3.5, 4.5];
const MIN_MARKET_PROBABILITY = 55;
const MAX_MARKET_PROBABILITY = 82;

function poissonOverProbability(mean: number, line: number): number {
  if (!Number.isFinite(mean) || mean < 0) return 0;
  const firstOver = Math.floor(line) + 1;
  let probabilityUnder = Math.exp(-mean);
  let term = probabilityUnder;
  for (let goals = 1; goals < firstOver; goals += 1) {
    term *= mean / goals;
    probabilityUnder += term;
  }
  return Math.max(0, Math.min(1, 1 - probabilityUnder));
}

function roundPercent(value: number): number {
  return Math.round(value * 100);
}

function addCandidate(
  list: MarketCandidate[],
  candidate: MarketCandidate,
): void {
  if (
    candidate.probability >= MIN_MARKET_PROBABILITY &&
    candidate.probability <= MAX_MARKET_PROBABILITY
  ) {
    list.push(candidate);
  }
}

function teamExpectedGoals(scored: TeamGoalForm, conceded: TeamGoalForm): number | null {
  if (scored.played < 3 || conceded.played < 3) return null;
  const scoredRate = scored.goalsFor / scored.played;
  const concededRate = conceded.goalsAgainst / conceded.played;
  return Math.max(0.05, (scoredRate + concededRate) / 2);
}

function playerMetricCandidates(
  player: PlayerSeasonStats,
  candidates: MarketCandidate[],
): void {
  if (player.appearances < 5) return;
  const metrics = [
    { key: "goals", label: "goles", value: player.goals },
    { key: "shots", label: "remates", value: player.shots },
    { key: "shots-on-target", label: "remates a puerta", value: player.shotsOnTarget },
    { key: "fouls-committed", label: "faltas cometidas", value: player.foulsCommitted },
    { key: "fouls-drawn", label: "faltas recibidas", value: player.foulsDrawn },
    { key: "yellow-cards", label: "tarjetas amarillas", value: player.yellowCards },
  ] as const;

  for (const metric of metrics) {
    if (typeof metric.value !== "number" || metric.value < 0) continue;
    const mean = metric.value / player.appearances;
    const options = PLAYER_LINES.flatMap((line) => {
      const over = roundPercent(poissonOverProbability(mean, line));
      return [
        { line, side: "Más de", probability: over },
        { line, side: "Menos de", probability: 100 - over },
      ];
    }).filter(
      (option) =>
        option.probability >= MIN_MARKET_PROBABILITY &&
        option.probability <= MAX_MARKET_PROBABILITY,
    );
    options.sort((a, b) => Math.abs(a.probability - 68) - Math.abs(b.probability - 68));
    const best = options[0];
    if (!best) continue;
    addCandidate(candidates, {
      id: `player-${player.id}-${metric.key}-${best.side === "Más de" ? "over" : "under"}-${best.line}`,
      category: "player",
      title: `${player.name} · ${metric.label}`,
      selection: `${best.side} ${best.line} ${metric.label}`,
      probability: best.probability,
      evidence: `${metric.value} en ${player.appearances} apariciones (${mean.toFixed(2)} por partido). ${player.team}.`,
      sampleSize: player.appearances,
    });
  }
}

export function buildMarketCandidates({
  homeTeam,
  awayTeam,
  homeForm,
  awayForm,
  players,
}: BuildMarketOptions): MarketCandidate[] {
  const candidates: MarketCandidate[] = [];
  const homeMean = teamExpectedGoals(homeForm, awayForm);
  const awayMean = teamExpectedGoals(awayForm, homeForm);

  if (homeMean !== null && awayMean !== null) {
    const totalMean = homeMean + awayMean;
    const formSample = Math.min(homeForm.played, awayForm.played);
    const goalEvidence = `Estimación ${totalMean.toFixed(2)} goles; forma de ${homeForm.played} partidos de ${homeTeam} y ${awayForm.played} de ${awayTeam}.`;

    for (const line of GOAL_LINES) {
      const over = roundPercent(poissonOverProbability(totalMean, line));
      addCandidate(candidates, {
        id: `match-goals-over-${line}`,
        category: "match-goals",
        title: "Goles totales",
        selection: `Más de ${line} goles`,
        probability: over,
        evidence: goalEvidence,
        sampleSize: formSample,
      });
      addCandidate(candidates, {
        id: `match-goals-under-${line}`,
        category: "match-goals",
        title: "Goles totales",
        selection: `Menos de ${line} goles`,
        probability: 100 - over,
        evidence: goalEvidence,
        sampleSize: formSample,
      });
    }

    for (const [side, team, mean] of [
      ["home", homeTeam, homeMean],
      ["away", awayTeam, awayMean],
    ] as const) {
      for (const line of [0.5, 1.5, 2.5, 3.5]) {
        const over = roundPercent(poissonOverProbability(mean, line));
        addCandidate(candidates, {
          id: `team-goals-${side}-over-${line}`,
          category: "team-goals",
          title: `${team} · goles del equipo`,
          selection: `Más de ${line} goles`,
          probability: over,
          evidence: `Media estimada: ${mean.toFixed(2)} goles por partido, basada en los últimos ${formSample} partidos disponibles.`,
          sampleSize: formSample,
        });
        addCandidate(candidates, {
          id: `team-goals-${side}-under-${line}`,
          category: "team-goals",
          title: `${team} · goles del equipo`,
          selection: `Menos de ${line} goles`,
          probability: 100 - over,
          evidence: `Media estimada: ${mean.toFixed(2)} goles por partido, basada en los últimos ${formSample} partidos disponibles.`,
          sampleSize: formSample,
        });
      }
    }
  }

  const playerCandidates: MarketCandidate[] = [];
  for (const player of players) playerMetricCandidates(player, playerCandidates);
  playerCandidates.sort((a, b) => {
    const confidenceA = Math.abs(a.probability - 68) + Math.max(0, 10 - a.sampleSize) * 2;
    const confidenceB = Math.abs(b.probability - 68) + Math.max(0, 10 - b.sampleSize) * 2;
    return confidenceA - confidenceB;
  });
  candidates.push(...playerCandidates.slice(0, 12));

  return candidates;
}