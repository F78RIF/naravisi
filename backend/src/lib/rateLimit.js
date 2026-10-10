/**
 * Pembatas percobaan sederhana di memori (cukup untuk satu proses server).
 * Dipakai untuk menahan tebakan kata sandi beruntun pada login (hasil evaluasi Fase 7, E-01).
 */
export function createFailureLimiter({ max, windowMs, clock }) {
  const entries = new Map();

  function prune(now) {
    if (entries.size < 1000) return;
    for (const [k, v] of entries) if (v.resetAt <= now) entries.delete(k);
  }

  return {
    /** Sisa milidetik penguncian, atau 0 bila boleh mencoba. */
    blockedFor(key) {
      const now = clock.now().getTime();
      const e = entries.get(key);
      if (!e || e.resetAt <= now) return 0;
      return e.count >= max ? e.resetAt - now : 0;
    },
    fail(key) {
      const now = clock.now().getTime();
      prune(now);
      const e = entries.get(key);
      if (!e || e.resetAt <= now) entries.set(key, { count: 1, resetAt: now + windowMs });
      else e.count += 1;
    },
    reset(key) {
      entries.delete(key);
    },
  };
}
