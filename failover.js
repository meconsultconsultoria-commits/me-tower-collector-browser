export const SOURCES = [
  "https://rastroseguro.1gps.com.br",
  "https://rastroseguro.2gps.com.br",
];

// Each attempt owns a separate browser context. Only a complete result is ingested.
export async function collectWithFailover(collect, log = console) {
  for (const [index, source] of SOURCES.entries()) {
    try {
      const vehicles = await collect(source);
      if (!Array.isArray(vehicles) || vehicles.length < 250) {
        throw new Error("incomplete_fleet");
      }
      log.info(`Coleta válida: ${index ? "contingência 2GPS" : "principal 1GPS"}; ${vehicles.length} veículos.`);
      return { vehicles, source, contingency: index > 0 };
    } catch {
      // Do not log page contents, URLs with session identifiers, or credentials.
      log.warn(`Falha de coleta no ${index ? "2GPS" : "1GPS"}.${index ? "" : " Acionando contingência 2GPS."}`);
    }
  }
  throw new Error("Principal e contingência indisponíveis ou sem frota completa. Última coleta preservada; nenhum dado enviado.");
}
