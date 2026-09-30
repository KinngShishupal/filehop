import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Direction,
  FileHopEvents,
  FileMeta,
  isSupported,
  ProgressEvent,
  TERMINAL_STATES,
  TransferStateName,
} from '../native/fileHop';

export type Transfer = {
  id: string;
  direction: Direction;
  peerName: string;
  files: FileMeta[];
  totalBytes: number;
  state: TransferStateName;
  error?: string;
  progress?: ProgressEvent;
  createdAt: number;
};

export function isActive(t: Transfer) {
  return !TERMINAL_STATES.includes(t.state);
}

/**
 * Tracks every transfer in one direction. Native events can arrive before the
 * JS side registers a transfer, so both paths merge into the same record.
 */
export function useTransfers(direction: Direction) {
  const [byId, setById] = useState<Record<string, Transfer>>({});

  const upsert = useCallback(
    (id: string, patch: Partial<Transfer>) => {
      setById(prev => {
        const existing: Transfer = prev[id] ?? {
          id,
          direction,
          peerName: '',
          files: [],
          totalBytes: 0,
          state: 'connecting',
          createdAt: Date.now(),
        };
        return { ...prev, [id]: { ...existing, ...patch } };
      });
    },
    [direction],
  );

  useEffect(() => {
    if (!isSupported) {
      return;
    }
    const subs = [
      FileHopEvents.onState(e => {
        if (e.direction === direction) {
          upsert(e.transferId, { state: e.state, error: e.error });
        }
      }),
      FileHopEvents.onProgress(e => {
        if (e.direction === direction) {
          upsert(e.transferId, { progress: e });
        }
      }),
    ];
    return () => subs.forEach(s => s.remove());
  }, [direction, upsert]);

  const dismiss = useCallback((id: string) => {
    setById(prev => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const transfers = useMemo(
    () => Object.values(byId).sort((a, b) => b.createdAt - a.createdAt),
    [byId],
  );

  return { transfers, upsert, dismiss };
}
