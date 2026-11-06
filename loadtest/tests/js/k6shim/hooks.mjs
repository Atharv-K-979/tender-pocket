const MAP = { k6: 'k6.mjs', 'k6/http': 'http.mjs', 'k6/execution': 'execution.mjs', 'k6/metrics': 'metrics.mjs', 'k6/browser': 'browser.mjs' };
export async function resolve(specifier, context, next) {
  if (MAP[specifier]) return { url: new URL(`./${MAP[specifier]}`, import.meta.url).href, shortCircuit: true };
  return next(specifier, context);
}
