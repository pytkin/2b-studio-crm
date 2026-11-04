import { useEffect, useRef } from 'react';

// A cached row may still be useful during a transient failure on an open card.
// On entering another card (including Back), wait for its first successful read.
export function useVisitRead(
  key: string,
  result: { isSuccess: boolean; isFetchedAfterMount: boolean },
) {
  const confirmed = useRef<string | null>(null);
  const now = result.isSuccess && result.isFetchedAfterMount;
  useEffect(() => {
    if (confirmed.current !== key) confirmed.current = null;
    if (now) confirmed.current = key;
  }, [now, key]);
  return now || confirmed.current === key;
}
