export type TeamGoalForm = {
  played: number;
  goalsFor: number;
  goalsAgainst: number;
};

export type MarketCandidate = {
  id: string;
  category: "match-goals" | "team-goals";
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

export function buildMarketCandidates({
  homeTeam,
  awayTeam,
  homeForm,
  awayForm,
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

  return candidates;
}