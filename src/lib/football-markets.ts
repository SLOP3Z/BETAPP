export type TeamGoalForm = {
  played: number;
  goalsFor: number;
  goalsAgainst: number;
};

export type MarketCandidate = {
  id: string;
  category:
    | "match-goals"
    | "team-goals"
    | "match-result"
    | "btts"
    | "cards"
    | "shots";
  title: string;
  selection: string;
  probability: number;
  evidence: string;
  sampleSize: number;
};

/** Media de una magnitud por partido (tarjetas, remates...) con su muestra. */
export type CountAverage = {
  average: number;
  matches: number;
};

type BuildMarketOptions = {
  homeTeam: string;
  awayTeam: string;
  homeForm: TeamGoalForm;
  awayForm: TeamGoalForm;
  /** Opcional: tarjetas por partido del árbitro designado. */
  referee?: { name: string; cards: CountAverage };
  /** Opcional: remates totales por partido de cada equipo (a favor + en contra). */
  shots?: { home: CountAverage; away: CountAverage };
};

const GOAL_LINES = [0.5, 1.5, 2.5, 3.5, 4.5];
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

// El 1X2 puro rara vez llega al 55 %, así que tiene un mínimo más bajo.
const MIN_PROBABILITY_BY_CATEGORY: Partial<Record<MarketCandidate["category"], number>> = {
  "match-result": 45,
};
const MIN_SAMPLE_CARDS = 5;
const MIN_SAMPLE_SHOTS = 5;
const SCORE_MATRIX_SIZE = 11; // marcadores de 0 a 10 goles por equipo

function addCandidate(
  list: MarketCandidate[],
  candidate: MarketCandidate,
): void {
  const min = MIN_PROBABILITY_BY_CATEGORY[candidate.category] ?? MIN_MARKET_PROBABILITY;
  if (candidate.probability >= min && candidate.probability <= MAX_MARKET_PROBABILITY) {
    list.push(candidate);
  }
}

function poissonPmf(mean: number, size: number): number[] {
  const pmf: number[] = [Math.exp(-mean)];
  for (let k = 1; k < size; k += 1) pmf.push((pmf[k - 1] * mean) / k);
  return pmf;
}

/** 1X2 y ambos marcan a partir de dos Poisson independientes. */
function scoreMatrixProbabilities(homeMean: number, awayMean: number) {
  const home = poissonPmf(homeMean, SCORE_MATRIX_SIZE);
  const away = poissonPmf(awayMean, SCORE_MATRIX_SIZE);
  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;
  for (let h = 0; h < SCORE_MATRIX_SIZE; h += 1) {
    for (let a = 0; a < SCORE_MATRIX_SIZE; a += 1) {
      const p = home[h] * away[a];
      if (h > a) homeWin += p;
      else if (h === a) draw += p;
      else awayWin += p;
    }
  }
  const total = homeWin + draw + awayWin; // normaliza la cola truncada
  const bttsYes = (1 - home[0]) * (1 - away[0]);
  return {
    homeWin: homeWin / total,
    draw: draw / total,
    awayWin: awayWin / total,
    bttsYes,
  };
}

function addTotalLines(
  list: MarketCandidate[],
  options: {
    category: "cards" | "shots";
    title: string;
    idPrefix: string;
    mean: number;
    lines: number[];
    evidence: string;
    sampleSize: number;
  },
): void {
  for (const line of options.lines) {
    const over = roundPercent(poissonOverProbability(options.mean, line));
    for (const [kind, label, probability] of [
      ["over", "Más de", over],
      ["under", "Menos de", 100 - over],
    ] as const) {
      addCandidate(list, {
        id: `${options.idPrefix}-${kind}-${line}`,
        category: options.category,
        title: options.title,
        selection: `${label} ${line}`,
        probability,
        evidence: options.evidence,
        sampleSize: options.sampleSize,
      });
    }
  }
}

function teamExpectedGoals(scored: TeamGoalForm, conceded: TeamGoalForm): number | null {
  if (scored.played < 3 || conceded.played < 3) return null;
  const scoredRate = scored.goalsFor / scored.played;
  const concededRate = conceded.goalsAgainst / conceded.played;
  return Math.max(0.05, (scoredRate + concededRate) / 2);
}

export function buildMarketCandidates({
  homeTeam,
  awayTeam,
  homeForm,
  awayForm,
  referee,
  shots,
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

    const grid = scoreMatrixProbabilities(homeMean, awayMean);
    const resultEvidence = `Goles esperados: ${homeTeam} ${homeMean.toFixed(2)} y ${awayTeam} ${awayMean.toFixed(2)}, con forma de ${homeForm.played} y ${awayForm.played} partidos.`;
    for (const [id, selection, probability] of [
      ["1", `Gana ${homeTeam}`, grid.homeWin],
      ["x", "Empate", grid.draw],
      ["2", `Gana ${awayTeam}`, grid.awayWin],
    ] as const) {
      addCandidate(candidates, {
        id: `match-result-${id}`,
        category: "match-result",
        title: "Ganador del partido (1X2)",
        selection,
        probability: roundPercent(probability),
        evidence: resultEvidence,
        sampleSize: formSample,
      });
    }
    for (const [id, selection, probability] of [
      ["yes", "Ambos equipos marcan: Sí", grid.bttsYes],
      ["no", "Ambos equipos marcan: No", 1 - grid.bttsYes],
    ] as const) {
      addCandidate(candidates, {
        id: `btts-${id}`,
        category: "btts",
        title: "Ambos equipos marcan",
        selection,
        probability: roundPercent(probability),
        evidence: resultEvidence,
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

  if (referee && referee.cards.matches >= MIN_SAMPLE_CARDS && referee.cards.average > 0) {
    addTotalLines(candidates, {
      category: "cards",
      title: `Tarjetas · árbitro ${referee.name}`,
      idPrefix: "cards-total",
      mean: referee.cards.average,
      lines: [2.5, 3.5, 4.5, 5.5, 6.5],
      evidence: `${referee.name} saca ${referee.cards.average.toFixed(2)} tarjetas por partido en ${referee.cards.matches} partidos.`,
      sampleSize: referee.cards.matches,
    });
  }

  if (
    shots &&
    Math.min(shots.home.matches, shots.away.matches) >= MIN_SAMPLE_SHOTS &&
    shots.home.average > 0 &&
    shots.away.average > 0
  ) {
    const mean = shots.home.average + shots.away.average;
    addTotalLines(candidates, {
      category: "shots",
      title: "Remates totales",
      idPrefix: "shots-total",
      mean,
      lines: [18.5, 20.5, 22.5, 24.5, 26.5],
      evidence: `${homeTeam} y ${awayTeam} suman ${mean.toFixed(1)} remates esperados por partido.`,
      sampleSize: Math.min(shots.home.matches, shots.away.matches),
    });
  }

  return candidates.sort((a, b) => b.probability - a.probability);
}
