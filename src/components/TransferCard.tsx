import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { isActive, Transfer } from '../hooks/useTransfers';
import { colors, radius, spacing } from '../theme';
import {
  formatBytes,
  formatDuration,
  formatSpeed,
  pluralize,
} from '../utils/format';
import { Button } from './Button';

const STATE_LABEL: Record<Transfer['state'], string> = {
  connecting: 'Connecting…',
  waiting: 'Waiting for them to accept…',
  transferring: 'Transferring',
  completed: 'Done',
  declined: 'Declined',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

type Props = {
  transfer: Transfer;
  onCancel: () => void;
  onDismiss: () => void;
};

export function TransferCard({ transfer, onCancel, onDismiss }: Props) {
  const accent = transfer.direction === 'send' ? colors.send : colors.receive;
  const p = transfer.progress;
  const total = p?.totalBytes ?? transfer.totalBytes;
  const done = p?.bytesDone ?? 0;
  const fraction = total > 0 ? Math.min(1, done / total) : 0;
  const active = isActive(transfer);
  const completed = transfer.state === 'completed';
  const remainingMs =
    p && p.bytesPerSecond > 0
      ? ((total - done) / p.bytesPerSecond) * 1000
      : NaN;

  const title =
    transfer.direction === 'send'
      ? `To ${transfer.peerName || 'nearby phone'}`
      : `From ${transfer.peerName || 'nearby phone'}`;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
        <Text
          style={[
            styles.state,
            {
              color: completed
                ? accent
                : transfer.state === 'failed'
                ? colors.danger
                : colors.textMuted,
            },
          ]}
        >
          {STATE_LABEL[transfer.state]}
        </Text>
      </View>

      <View style={styles.track}>
        <View
          style={[
            styles.fill,
            {
              backgroundColor: accent,
              width: `${(completed ? 1 : fraction) * 100}%`,
            },
          ]}
        />
      </View>

      {transfer.state === 'transferring' && p ? (
        <>
          <View style={styles.row}>
            <Text style={[styles.speed, { color: accent }]}>
              {formatSpeed(p.bytesPerSecond)}
            </Text>
            <Text style={styles.muted}>
              {Math.floor(fraction * 100)}% · {formatDuration(remainingMs)} left
            </Text>
          </View>
          <Text style={styles.muted} numberOfLines={1}>
            {formatBytes(done)} of {formatBytes(total)} · file {p.fileIndex + 1}
            /{p.fileCount}: {p.fileName}
          </Text>
        </>
      ) : null}

      {completed && p ? (
        <Text style={styles.muted}>
          {pluralize(p.fileCount, 'file')} · {formatBytes(total)} in{' '}
          {formatDuration(p.elapsedMs)} · avg {formatSpeed(p.bytesPerSecond)}
        </Text>
      ) : null}

      {!active && !completed && transfer.error ? (
        <Text style={styles.error}>{transfer.error}</Text>
      ) : null}

      {!p && active ? (
        <Text style={styles.muted}>
          {pluralize(transfer.files.length, 'file')} ·{' '}
          {formatBytes(transfer.totalBytes)}
        </Text>
      ) : null}

      <View style={styles.actions}>
        {active ? (
          <Button
            title="Cancel"
            variant="ghost"
            color={colors.danger}
            onPress={onCancel}
          />
        ) : (
          <Button
            title="Dismiss"
            variant="ghost"
            color={colors.textMuted}
            onPress={onDismiss}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: { color: colors.text, fontSize: 16, fontWeight: '700', flexShrink: 1 },
  state: { fontSize: 13, fontWeight: '600' },
  track: {
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: radius.pill },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  speed: { fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] },
  muted: {
    color: colors.textMuted,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  error: { color: colors.danger, fontSize: 13 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end' },
});
