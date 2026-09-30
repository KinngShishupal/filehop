/**
 * FileHop — fast phone-to-phone file transfer over local Wi-Fi.
 *
 * @format
 */

import React, { useEffect, useState } from 'react';
import { StatusBar, StyleSheet, View } from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { FileHop, isSupported } from './src/native/fileHop';
import { HomeScreen } from './src/screens/HomeScreen';
import { ReceiveScreen } from './src/screens/ReceiveScreen';
import { SendScreen } from './src/screens/SendScreen';
import { colors, spacing } from './src/theme';

type Route = 'home' | 'send' | 'receive';

function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent() {
  const insets = useSafeAreaInsets();
  const [route, setRoute] = useState<Route>('home');
  const [deviceName, setDeviceName] = useState('');

  useEffect(() => {
    if (isSupported) {
      FileHop.getDeviceInfo()
        .then(info => setDeviceName(info.name))
        .catch(() => setDeviceName('Android phone'));
    }
  }, []);

  const goHome = () => setRoute('home');

  return (
    <View
      style={[
        styles.container,
        { paddingTop: insets.top, paddingBottom: insets.bottom },
      ]}
    >
      {route === 'home' ? (
        <HomeScreen
          deviceName={deviceName}
          onSend={() => setRoute('send')}
          onReceive={() => setRoute('receive')}
        />
      ) : route === 'send' ? (
        <SendScreen deviceName={deviceName} onBack={goHome} />
      ) : (
        <ReceiveScreen deviceName={deviceName} onBack={goHome} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.md,
  },
});

export default App;
