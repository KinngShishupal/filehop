import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useWifiEnabled } from '../hooks/useWifiEnabled';
import { FileHop } from '../native/fileHop';
import { colors, radius, spacing } from '../theme';
import { Button } from './Button';

/** Wi-Fi Direct needs the Wi-Fi radio on (connecting to a network is optional). */
export function WifiOffBanner() {
  const wifiOn = useWifiEnabled();
  if (wifiOn !== false) {
    return null;
  }
  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Text style={styles.title}>Wi-Fi is off</Text>
      <Text style={styles.body}>
        Turn Wi-Fi on to find nearby phones. You don't need to connect to a
        network.
      </Text>
      <Button
        title="Turn on Wi-Fi"
        color={colors.warning}
        onPress={() => FileHop.openWifiSettings()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.warning + '1F',
    borderWidth: 1,
    borderColor: colors.warning + '66',
  },
  title: { color: colors.warning, fontSize: 16, fontWeight: '700' },
  body: { color: colors.text, fontSize: 14 },
});
