function normalizeTeamName(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Compara dos nombres de equipo de football-data.org.
 * Los nombres salen de la misma API, así que basta la igualdad exacta
 * (sin tildes ni mayúsculas). No se compara "la última palabra": eso
 * mezclaba equipos distintos, como "Rayo Vallecano de Madrid" con
 * "Real Madrid" o "Elche CF" con "Valencia CF".
 */
export function sameTeam(label: string | undefined, query: string | undefined): boolean {
  const a = normalizeTeamName(label);
  const b = normalizeTeamName(query);
  return a !== "" && a === b;
}
