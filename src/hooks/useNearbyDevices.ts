import { useEffect, useState } from 'react';
import {
  FileHop,
  FileHopEvents,
  isSupported,
  NearbyDevice,
} from '../native/fileHop';

/** Receivers announce every second; drop any we haven't heard from in a while. */
const STALE_AFTER_MS = 4500;

type Seen = NearbyDevice & { lastSeen: number };

export function useNearbyDevices(enabled: boolean) {
  const [devices, setDevices] = useState<Seen[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !isSupported) {
      return;
    }
    const sub = FileHopEvents.onDevice(device => {
      setDevices(prev => {
        const seen = { ...device, lastSeen: Date.now() };
        const index = prev.findIndex(d => d.id === device.id);
        if (index === -1) {
          return [...prev, seen];
        }
        const current = prev[index];
        // Seen both ways (same Wi-Fi *and* Wi-Fi Direct): the shared network is faster to use.
        if (
          device.transport === 'direct' &&
          current.transport === 'lan' &&
          current.lastSeen >= Date.now() - STALE_AFTER_MS
        ) {
          return prev;
        }
        const next = prev.slice();
        next[index] = seen;
        return next;
      });
    });
    const prune = setInterval(() => {
      const cutoff = Date.now() - STALE_AFTER_MS;
      setDevices(prev =>
        prev.some(d => d.lastSeen < cutoff)
          ? prev.filter(d => d.lastSeen >= cutoff)
          : prev,
      );
    }, 1000);

    FileHop.startDiscovery()
      .then(() => setError(null))
      .catch((e: Error) => setError(e.message));

    return () => {
      sub.remove();
      clearInterval(prune);
      FileHop.stopDiscovery();
    };
  }, [enabled]);

  return { devices, error };
}
