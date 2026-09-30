import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Button } from '../components/Button';
import { FileRow } from '../components/FileRow';
import { Header } from '../components/Header';
import { TransferCard } from '../components/TransferCard';
import { useGuardedBack } from '../hooks/useGuardedBack';
import { useNearbyDevices } from '../hooks/useNearbyDevices';
import { useTransfers } from '../hooks/useTransfers';
import {
  FileHop,
  NearbyDevice,
  parseManualAddress,
  PickedFile,
} from '../native/fileHop';
import { colors, radius, spacing } from '../theme';
import { formatBytes, pluralize } from '../utils/format';

type Props = { deviceName: string; onBack: () => void };

export function SendScreen({ deviceName, onBack }: Props) {
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [manual, setManual] = useState('');
  const { devices, error: discoveryError } = useNearbyDevices(true);
  const { transfers, upsert, dismiss } = useTransfers('send');
  const goBack = useGuardedBack(transfers, onBack);

  const sendable = files.filter(f => f.size >= 0);
  const totalBytes = sendable.reduce((sum, f) => sum + f.size, 0);

  const addFiles = async () => {
    try {
      const picked = await FileHop.pickFiles();
      setFiles(prev => {
        const known = new Set(prev.map(f => f.uri));
        return [...prev, ...picked.filter(f => !known.has(f.uri))];
      });
    } catch (e) {
      Alert.alert("Couldn't open files", (e as Error).message);
    }
  };

  const sendTo = async (
    target: Pick<NearbyDevice, 'host' | 'port'>,
    name: string,
  ) => {
    if (sendable.length === 0) {
      Alert.alert(
        'Add files first',
        'Pick what you want to send, then tap a phone.',
      );
      return;
    }
    try {
      const id = await FileHop.sendFiles(target, deviceName, sendable);
      upsert(id, { peerName: name, files: sendable, totalBytes });
    } catch (e) {
      Alert.alert("Couldn't send", (e as Error).message);
    }
  };

  const sendManual = () => {
    const target = parseManualAddress(manual);
    if (!target) {
      Alert.alert(
        'Check the address',
        'Type it exactly as the receiving phone shows it, e.g. 192.168.1.20:45455',
      );
      return;
    }
    sendTo(target, target.host);
  };

  return (
    <View style={styles.container}>
      <Header title="Send" onBack={goBack} />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        {transfers.map(t => (
          <TransferCard
            key={t.id}
            transfer={t}
            onCancel={() => FileHop.cancelTransfer(t.id)}
            onDismiss={() => dismiss(t.id)}
          />
        ))}

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>
              {files.length
                ? `${pluralize(sendable.length, 'file')} · ${formatBytes(
                    totalBytes,
                  )}`
                : 'Files'}
            </Text>
            {files.length ? (
              <Pressable hitSlop={8} onPress={() => setFiles([])}>
                <Text style={styles.link}>Clear</Text>
              </Pressable>
            ) : null}
          </View>
          {files.map(f => (
            <FileRow
              key={f.uri}
              name={f.name}
              size={f.size}
              mime={f.mime}
              onRemove={() =>
                setFiles(prev => prev.filter(x => x.uri !== f.uri))
              }
            />
          ))}
          <Button
            title={files.length ? 'Add more' : 'Choose files'}
            onPress={addFiles}
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Nearby phones</Text>
          {devices.length === 0 ? (
            <View style={styles.searching}>
              <ActivityIndicator color={colors.send} />
              <Text style={styles.muted}>
                {discoveryError ??
                  'Looking for phones… Open FileHop on the other phone and tap Receive.'}
              </Text>
            </View>
          ) : (
            devices.map(d => (
              <Pressable
                key={d.id}
                accessibilityRole="button"
                accessibilityLabel={`Send to ${d.name}`}
                onPress={() => sendTo(d, d.name)}
                style={({ pressed }) => [
                  styles.device,
                  pressed && styles.pressed,
                ]}
              >
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {d.name.slice(0, 1).toUpperCase()}
                  </Text>
                </View>
                <View style={styles.deviceInfo}>
                  <Text style={styles.deviceName} numberOfLines={1}>
                    {d.name}
                  </Text>
                  <Text style={styles.muted}>{d.host}</Text>
                </View>
                <Text style={styles.link}>Send ›</Text>
              </Pressable>
            ))
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Not showing up?</Text>
          <Text style={styles.muted}>
            Type the address shown on the receiving phone.
          </Text>
          <View style={styles.manualRow}>
            <TextInput
              value={manual}
              onChangeText={setManual}
              placeholder="192.168.1.20:45455"
              placeholderTextColor={colors.textMuted}
              keyboardType="numbers-and-punctuation"
              autoCorrect={false}
              autoCapitalize="none"
              returnKeyType="send"
              onSubmitEditing={sendManual}
              style={styles.input}
            />
            <Button
              title="Send"
              onPress={sendManual}
              disabled={!manual.trim()}
            />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { gap: spacing.lg, paddingVertical: spacing.md },
  section: {
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  link: { color: colors.send, fontSize: 15, fontWeight: '700' },
  muted: { color: colors.textMuted, fontSize: 14, flexShrink: 1 },
  searching: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  device: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.sm,
    borderRadius: radius.sm,
  },
  pressed: { backgroundColor: colors.surfaceRaised },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.receive + '33',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.receive, fontSize: 18, fontWeight: '800' },
  deviceInfo: { flex: 1 },
  deviceName: { color: colors.text, fontSize: 16, fontWeight: '700' },
  manualRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  input: {
    flex: 1,
    minHeight: 48,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceRaised,
    color: colors.text,
    fontSize: 16,
  },
});
