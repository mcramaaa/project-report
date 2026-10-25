export function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'P2002';
}

/** InnoDB deadlock (1213) / write conflict: the transaction was rolled back and may be retried. */
export function isWriteConflict(err: unknown): boolean {
  const e = err as { code?: string; meta?: { driverAdapterError?: { cause?: { kind?: string } } } } | null;
  return e?.code === 'P2034' || e?.meta?.driverAdapterError?.cause?.kind === 'TransactionWriteConflict';
}

/** Re-runs a whole transaction after a deadlock, as MySQL recommends. Bounded; other errors pass through. */
export async function retryOnWriteConflict<T>(run: () => Promise<T>, attempts = 3): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (err) {
      if (attempt >= attempts || !isWriteConflict(err)) throw err;
    }
  }
}
