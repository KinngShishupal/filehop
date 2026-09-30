import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { radius } from '../theme';

type Kind = { label: string; color: string };

const ARCHIVES = ['zip', 'rar', '7z', 'tar', 'gz'];
const DOCS = [
  'doc',
  'docx',
  'txt',
  'rtf',
  'odt',
  'xls',
  'xlsx',
  'csv',
  'ppt',
  'pptx',
];

export function fileKind(name: string, mime: string): Kind {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (mime.startsWith('image/')) return { label: 'IMG', color: '#E879F9' };
  if (mime.startsWith('video/')) return { label: 'VID', color: '#FF7A59' };
  if (mime.startsWith('audio/')) return { label: 'AUD', color: '#FACC15' };
  if (mime === 'application/pdf' || ext === 'pdf')
    return { label: 'PDF', color: '#FF5C6C' };
  if (ext === 'apk' || mime === 'application/vnd.android.package-archive') {
    return { label: 'APK', color: '#22C58B' };
  }
  if (ARCHIVES.includes(ext)) return { label: 'ZIP', color: '#A78BFA' };
  if (DOCS.includes(ext) || mime.startsWith('text/'))
    return { label: 'DOC', color: '#60A5FA' };
  return { label: 'FILE', color: '#8C96AD' };
}

export function FileIcon({ name, mime }: { name: string; mime: string }) {
  const kind = fileKind(name, mime);
  return (
    <View style={[styles.box, { backgroundColor: kind.color + '26' }]}>
      <Text style={[styles.label, { color: kind.color }]}>{kind.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
});
