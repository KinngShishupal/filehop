import { useCallback, useEffect } from 'react';
import { Alert, BackHandler } from 'react-native';
import { FileHop } from '../native/fileHop';
import { isActive, Transfer } from './useTransfers';

/**
 * Back (header or hardware) asks before abandoning running transfers,
 * then cancels them so nothing keeps streaming invisibly.
 */
export function useGuardedBack(transfers: Transfer[], onBack: () => void) {
  const goBack = useCallback(() => {
    const running = transfers.filter(isActive);
    if (running.length === 0) {
      onBack();
      return;
    }
    Alert.alert(
      'Stop transfer?',
      'Leaving this screen cancels what is still transferring.',
      [
        { text: 'Stay', style: 'cancel' },
        {
          text: 'Stop and leave',
          style: 'destructive',
          onPress: () => {
            running.forEach(t => FileHop.cancelTransfer(t.id));
            onBack();
          },
        },
      ],
    );
  }, [transfers, onBack]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      goBack();
      return true;
    });
    return () => sub.remove();
  }, [goBack]);

  return goBack;
}
