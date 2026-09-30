import React, { useEffect, useState } from 'react';
import { Alert, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button } from '../components/Button';
import { FileRow } from '../components/FileRow';
import { Header } from '../components/Header';
import { Pulse } from '../components/Pulse';
import { TransferCard } from '../components/TransferCard';
import { useGuardedBack } from '../hooks/useGuardedBack';
import { useTransfers } from '../hooks/useTransfers';
import {
  DEFAULT_PORT,
  FileHop,
  FileHopEvents,
  IncomingRequest,
  ReceivedFile,
  TERMINAL_STATES,
} from '../native/fileHop';
import { colors, radius, spacing } from '../theme';
import { formatBytes, pluralize } from '../utils/format';

type Props = { deviceName: string; onBack: () => void };

const PREVIEW_COUNT = 4;

export function ReceiveScreen({ deviceName, onBack }: Props) {
  const [address, setAddress] = useState<string | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [requests, setRequests] = useState<IncomingRequest[]>([]);
  const [received, setReceived] = useState<ReceivedFile[]>([]);
  const { transfers, upsert, dismiss } = useTransfers('receive');
  const goBack = useGuardedBack(transfers, onBack);

  useEffect(() => {
    let cancelled = false;
    FileHop.startReceiving(deviceName)
      .then(({ port, addresses }) => {
        if (!cancelled && addresses.length) {
          setAddress(
            port === DEFAULT_PORT ? addresses[0] : `${addresses[0]}:${port}`,
          );
        }
      })
      .catch((e: Error) => !cancelled && setStartError(e.message));

    const subs = [
      FileHopEvents.onIncoming(r => setRequests(prev => [...prev, r])),
      // A request can vanish before we answer (sender cancelled, 60 s timeout).
      FileHopEvents.onState(e => {
        if (TERMINAL_STATES.includes(e.state)) {
          setRequests(prev => prev.filter(r => r.transferId !== e.transferId));
        }
      }),
      FileHopEvents.onFileReceived(f => setReceived(prev => [f, ...prev])),
    ];
    return () => {
      cancelled = true;
      subs.forEach(s => s.remove());
      FileHop.stopReceiving();
    };
  }, [deviceName]);

  const request = requests[0];

  const answer = (accept: boolean) => {
    if (!request) {
      return;
    }
    FileHop.respondToIncoming(request.transferId, accept);
    if (accept) {
      upsert(request.transferId, {
        peerName: request.senderName,
        files: request.files,
        totalBytes: request.totalBytes,
        state: 'transferring',
      });
    }
    setRequests(prev => prev.slice(1));
  };

  const open = (f: ReceivedFile) =>
    FileHop.openFile(f.uri, f.mime).catch((e: Error) =>
      Alert.alert("Can't open", e.message),
    );

  return (
    <View style={styles.container}>
      <Header title="Receive" onBack={goBack} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.beacon}>
          <Pulse color={colors.receive} glyph="↓" />
          {startError ? (
            <Text style={styles.error}>{startError}</Text>
          ) : (
            <>
              <Text style={styles.visibleAs}>Visible as {deviceName}</Text>
              <Text style={styles.muted}>
                Keep this screen open. On the other phone, tap Send.
              </Text>
              {address ? (
                <View style={styles.addressPill}>
                  <Text style={styles.muted}>Manual address </Text>
                  <Text selectable style={styles.address}>
                    {address}
                  </Text>
                </View>
              ) : null}
            </>
          )}
        </View>

        {transfers.map(t => (
          <TransferCard
            key={t.id}
            transfer={t}
            onCancel={() => FileHop.cancelTransfer(t.id)}
            onDismiss={() => dismiss(t.id)}
          />
        ))}

        {received.length ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Received · tap to open</Text>
            <Text style={styles.muted}>Saved to Downloads/FileHop</Text>
            {received.map(f => (
              <FileRow
                key={`${f.transferId}:${f.index}`}
                name={f.name}
                size={f.size}
                mime={f.mime}
                onPress={() => open(f)}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>

      <Modal
        visible={!!request}
        transparent
        animationType="fade"
        onRequestClose={() => answer(false)}
      >
        <View style={styles.backdrop}>
          {request ? (
            <View style={styles.sheet}>
              <Text style={styles.sheetTitle}>
                {request.senderName} wants to send
              </Text>
              <Text style={styles.muted}>
                {pluralize(request.files.length, 'file')} ·{' '}
                {formatBytes(request.totalBytes)}
              </Text>
              <View>
                {request.files.slice(0, PREVIEW_COUNT).map((f, i) => (
                  <FileRow key={i} name={f.name} size={f.size} mime={f.mime} />
                ))}
                {request.files.length > PREVIEW_COUNT ? (
                  <Text style={styles.muted}>
                    and{' '}
                    {pluralize(
                      request.files.length - PREVIEW_COUNT,
                      'more file',
                    )}
                  </Text>
                ) : null}
              </View>
              <View style={styles.sheetActions}>
                <Button
                  title="Decline"
                  variant="ghost"
                  color={colors.textMuted}
                  onPress={() => answer(false)}
                  style={styles.flex}
                />
                <Button
                  title="Accept"
                  color={colors.receive}
                  onPress={() => answer(true)}
                  style={styles.flex}
                />
              </View>
            </View>
          ) : null}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { gap: spacing.lg, paddingVertical: spacing.md },
  beacon: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  visibleAs: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  muted: { color: colors.textMuted, fontSize: 14, textAlign: 'center' },
  error: { color: colors.danger, fontSize: 15, textAlign: 'center' },
  addressPill: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  address: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    fontVariant: ['tabular-nums'],
  },
  section: {
    gap: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  backdrop: {
    flex: 1,
    backgroundColor: '#000000AA',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.md,
  },
  sheetTitle: {
    color: colors.text,
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  sheetActions: { flexDirection: 'row', gap: spacing.md },
  flex: { flex: 1 },
});
