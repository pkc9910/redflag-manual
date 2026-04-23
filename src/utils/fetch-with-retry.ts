/**
 * Small fetch wrapper with exponential-backoff retry on network errors and 5xx.
 * The Nasdaq news feed and Yahoo endpoints flap 503 ↔ 200 routinely; a bare
 * fetch fails hard on the first blip and aborts the whole routine.
 */
export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  attempts = 3,
): Promise<Response> {
  let lastRes: Response | undefined;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, init);
      if (res.ok || res.status < 500) return res;
      lastRes = res;
    } catch (err) {
      lastErr = err;
    }
    if (i < attempts - 1) {
      const delay = 1000 * Math.pow(2, i);
      console.log(`fetch ${url} failed (attempt ${i + 1}/${attempts}); retrying in ${delay}ms`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  if (lastRes) return lastRes;
  throw lastErr ?? new Error(`fetch failed after ${attempts} attempts: ${url}`);
}
