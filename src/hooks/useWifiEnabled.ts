import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { FileHop, isSupported } from '../native/fileHop';

/** Polls while mounted and re-checks on returning from Settings. `null` until the first answer. */
export function useWifiEnabled() {
  const [enabled, setEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isSupported) {
      return;
    }
    let alive = true;
    const check = () =>
      FileHop.isWifiEnabled()
        .then(on => alive && setEnabled(on))
        .catch(() => {});
    check();
    const timer = setInterval(check, 2000);
    const sub = AppState.addEventListener('change', s => {
      if (s === 'active') {
        check();
      }
    });
    return () => {
      alive = false;
      clearInterval(timer);
      sub.remove();
    };
  }, []);

  return enabled;
}
