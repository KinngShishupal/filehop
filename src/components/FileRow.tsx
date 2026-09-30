import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../theme';
import { formatBytes } from '../utils/format';
import { FileIcon } from './FileIcon';

type Props = {
  name: string;
  size: number;
  mime: string;
  onPress?: () => void;
  onRemove?: () => void;
  note?: string;
};

export function FileRow({ name, size, mime, onPress, onRemove, note }: Props) {
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <FileIcon name={name} mime={mime} />
      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <Text style={[styles.meta, size < 0 && styles.bad]}>
          {size < 0 ? "Can't read this file" : formatBytes(size)}
          {note ? ` · ${note}` : ''}
        </Text>
      </View>
      {onRemove ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${name}`}
          hitSlop={12}
          onPress={onRemove}
          style={styles.remove}
        >
          <Text style={styles.removeText}>×</Text>
        </Pressable>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.sm,
  },
  pressed: { backgroundColor: colors.surfaceRaised },
  info: { flex: 1 },
  name: { color: colors.text, fontSize: 15, fontWeight: '600' },
  meta: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  bad: { color: colors.danger },
  remove: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  removeText: { color: colors.textMuted, fontSize: 20, lineHeight: 22 },
});
