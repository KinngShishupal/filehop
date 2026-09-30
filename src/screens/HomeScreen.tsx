import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { isSupported } from '../native/fileHop';
import { colors, radius, spacing } from '../theme';

type Props = {
  deviceName: string;
  onSend: () => void;
  onReceive: () => void;
};

export function HomeScreen({ deviceName, onSend, onReceive }: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.brand}>FileHop</Text>
        <Text style={styles.tagline}>
          Send PDFs, videos, music, apps, anything, straight to a nearby phone.
          No internet, no size limit.
        </Text>
      </View>

      <View style={styles.actions}>
        <ActionCard
          glyph="↑"
          title="Send"
          subtitle="Pick files and choose a nearby phone"
          color={colors.send}
          onPress={onSend}
          disabled={!isSupported}
        />
        <ActionCard
          glyph="↓"
          title="Receive"
          subtitle="Make this phone visible to senders"
          color={colors.receive}
          onPress={onReceive}
          disabled={!isSupported}
        />
      </View>

      <View style={styles.footer}>
        {isSupported ? (
          <>
            <Text style={styles.footerText}>
              Keep Wi-Fi turned on. The phones don't need to be on the same
              network.
            </Text>
            {deviceName ? (
              <Text style={styles.footerText}>You appear as {deviceName}</Text>
            ) : null}
          </>
        ) : (
          <Text style={[styles.footerText, styles.warning]}>
            Transfers currently work on Android only.
          </Text>
        )}
      </View>
    </View>
  );
}

type CardProps = {
  glyph: string;
  title: string;
  subtitle: string;
  color: string;
  onPress: () => void;
  disabled: boolean;
};

function ActionCard({
  glyph,
  title,
  subtitle,
  color,
  onPress,
  disabled,
}: CardProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { borderColor: color + '55' },
        (pressed || disabled) && styles.pressed,
      ]}
    >
      <View style={[styles.glyphCircle, { backgroundColor: color }]}>
        <Text style={styles.glyph}>{glyph}</Text>
      </View>
      <View style={styles.cardText}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardSubtitle}>{subtitle}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'space-between',
    paddingVertical: spacing.lg,
  },
  hero: { gap: spacing.sm, marginTop: spacing.xl },
  brand: {
    color: colors.text,
    fontSize: 44,
    fontWeight: '900',
    letterSpacing: -1,
  },
  tagline: { color: colors.textMuted, fontSize: 16, lineHeight: 23 },
  actions: { gap: spacing.md },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
  },
  pressed: { opacity: 0.7 },
  glyphCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glyph: { color: colors.text, fontSize: 28, fontWeight: '800' },
  cardText: { flex: 1, gap: 2 },
  cardTitle: { color: colors.text, fontSize: 22, fontWeight: '800' },
  cardSubtitle: { color: colors.textMuted, fontSize: 14 },
  footer: { gap: spacing.xs, alignItems: 'center' },
  footerText: { color: colors.textMuted, fontSize: 13, textAlign: 'center' },
  warning: { color: colors.warning },
});
