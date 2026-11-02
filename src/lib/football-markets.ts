export type TeamGoalForm = {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  winStreak: number;
  goalsFor: number;
  goalsAgainst: number;
  bothScored: number;
};

export type MarketCandidate = {
  id: string;
  category:
    | "match-goals"
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

const MIN_MARKET_PROBABILITY = 55;

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
const MIN_FORM_MATCHES = 5;

function addCandidate(
  list: MarketCandidate[],
  candidate: MarketCandidate,
): void {
  const min = MIN_PROBABILITY_BY_CATEGORY[candidate.category] ?? MIN_MARKET_PROBABILITY;
  if (candidate.probability >= min) {
    list.push(candidate);
  }
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
  if (scored.played < MIN_FORM_MATCHES || conceded.played < MIN_FORM_MATCHES) return null;
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

  const formSample = Math.min(homeForm.played, awayForm.played);
  const hasVenueSample = homeForm.played >= MIN_FORM_MATCHES && awayForm.played >= MIN_FORM_MATCHES;

  if (hasVenueSample) {
    const homeRate = {
      win: homeForm.wins / homeForm.played,
      draw: homeForm.draws / homeForm.played,
      loss: homeForm.losses / homeForm.played,
    };
    const awayRate = {
      win: awayForm.wins / awayForm.played,
      draw: awayForm.draws / awayForm.played,
      loss: awayForm.losses / awayForm.played,
    };
    const outcomes = [
      {
        id: "match-result-1",
        selection: `Gana ${homeTeam}`,
        probability: (homeRate.win + awayRate.loss) / 2,
          evidence: `${homeTeam} ganó ${homeForm.wins} de ${homeForm.played} partidos en casa; ${awayTeam} perdió ${awayForm.losses} de ${awayForm.played} fuera.`,
      },
      {
        id: "match-result-x",
        selection: "Empate",
        probability: (homeRate.draw + awayRate.draw) / 2,
        evidence: `En casa, ${homeTeam} empató ${homeForm.draws} de ${homeForm.played}; fuera, ${awayTeam} empató ${awayForm.draws} de ${awayForm.played}.`,
      },
      {
        id: "match-result-2",
        selection: `Gana ${awayTeam}`,
        probability: (homeRate.loss + awayRate.win) / 2,
        evidence: `${awayTeam} ganó ${awayForm.wins} de ${awayForm.played} partidos fuera; ${homeTeam} perdió ${homeForm.losses} de ${homeForm.played} en casa.`,
      },
    ];
    const resultTotal = outcomes.reduce((sum, outcome) => sum + outcome.probability, 0);
    for (const outcome of outcomes) {
      addCandidate(candidates, {
        id: outcome.id,
        category: "match-result",
        title: "Resultado 1X2",
        selection: outcome.selection,
        probability: roundPercent(outcome.probability / resultTotal),
        evidence: outcome.evidence,
        sampleSize: formSample,
      });
    }

    const homeBttsRate = homeForm.bothScored / homeForm.played;
    const awayBttsRate = awayForm.bothScored / awayForm.played;
    const bttsRate = (homeBttsRate + awayBttsRate) / 2;
    const bttsEvidence = `En casa, ${homeTeam} tuvo ambos-marcan en ${homeForm.bothScored} de ${homeForm.played}; fuera, ${awayTeam} en ${awayForm.bothScored} de ${awayForm.played}.`;
    if (homeBttsRate >= 0.6 && awayBttsRate >= 0.6) {
      addCandidate(candidates, {
        id: "btts-yes",
        category: "btts",
        title: "Ambos equipos marcan",
        selection: "Sí",
        probability: roundPercent(bttsRate),
        evidence: bttsEvidence,
        sampleSize: formSample,
      });
    } else if (homeBttsRate <= 0.4 && awayBttsRate <= 0.4) {
      addCandidate(candidates, {
        id: "btts-no",
        category: "btts",
        title: "Ambos equipos marcan",
        selection: "No",
        probability: roundPercent(1 - bttsRate),
        evidence: bttsEvidence,
        sampleSize: formSample,
      });
    }
  }

  if (homeMean !== null && awayMean !== null) {
    const totalMean = homeMean + awayMean;
    if (totalMean >= 2.8) {
      const probability = roundPercent(poissonOverProbability(totalMean, 2.5));
      addCandidate(candidates, {
        id: "match-goals-over-2.5",
        category: "match-goals",
        title: "Goles totales",
        selection: "Más de 2.5 goles",
        probability,
        evidence: `Media esperada ${totalMean.toFixed(2)} goles. ${homeTeam} en casa: ${homeForm.goalsFor} a favor y ${homeForm.goalsAgainst} en contra en ${homeForm.played} partidos; ${awayTeam} fuera: ${awayForm.goalsFor} a favor y ${awayForm.goalsAgainst} en contra en ${awayForm.played}.`,
        sampleSize: formSample,
      });
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

export function bestMarketCandidates(candidates: MarketCandidate[]): MarketCandidate[] {
  const familyFor = (category: MarketCandidate["category"]) => {
    if (category === "match-result") return "1x2";
    if (category === "btts") return "btts";
    if (category === "match-goals") return "goals";
    return category;
  };
  const bestByFamily = new Map<string, MarketCandidate>();
  for (const candidate of candidates) {
    const family = familyFor(candidate.category);
    const current = bestByFamily.get(family);
    if (!current || candidate.probability > current.probability) {
      bestByFamily.set(family, candidate);
    }
  }
  return [...bestByFamily.values()]
    .sort((a, b) => b.probability - a.probability)
    .slice(0, 3);
}
