import {
  DeviceEventEmitter,
  EmitterSubscription,
  NativeModules,
  PermissionsAndroid,
  Platform,
} from 'react-native';

export type PickedFile = {
  uri: string;
  name: string;
  /** -1 when the provider can't report a size; such files can't be sent. */
  size: number;
  mime: string;
};

export type FileMeta = { name: string; size: number; mime: string };

export type DeviceInfo = { id: string; name: string; addresses: string[] };

export type NearbyDevice = {
  id: string;
  name: string;
  host: string;
  port: number;
};

export type Direction = 'send' | 'receive';

export type TransferStateName =
  | 'connecting'
  | 'waiting'
  | 'transferring'
  | 'completed'
  | 'declined'
  | 'failed'
  | 'cancelled';

export const TERMINAL_STATES: TransferStateName[] = [
  'completed',
  'declined',
  'failed',
  'cancelled',
];

export type IncomingRequest = {
  transferId: string;
  senderName: string;
  host: string;
  totalBytes: number;
  files: FileMeta[];
};

export type TransferStateEvent = {
  transferId: string;
  direction: Direction;
  state: TransferStateName;
  error?: string;
};

export type ProgressEvent = {
  transferId: string;
  direction: Direction;
  bytesDone: number;
  totalBytes: number;
  fileIndex: number;
  fileCount: number;
  fileName: string;
  bytesPerSecond: number;
  elapsedMs: number;
};

export type ReceivedFile = FileMeta & {
  transferId: string;
  index: number;
  uri: string;
};

type NativeFileHop = {
  getDeviceInfo(): Promise<DeviceInfo>;
  pickFiles(): Promise<PickedFile[]>;
  openFile(uri: string, mime: string): Promise<void>;
  startReceiving(
    displayName: string,
  ): Promise<{ port: number; addresses: string[] }>;
  stopReceiving(): void;
  respondToIncoming(transferId: string, accept: boolean): void;
  startDiscovery(): Promise<void>;
  stopDiscovery(): void;
  sendFiles(
    host: string,
    port: number,
    senderName: string,
    files: PickedFile[],
  ): Promise<string>;
  cancelTransfer(transferId: string): void;
};

const Native: NativeFileHop | undefined = NativeModules.FileHop;

export const isSupported = Platform.OS === 'android' && Native != null;

function native(): NativeFileHop {
  if (!Native) {
    throw new Error('FileHop transfers are only available on Android.');
  }
  return Native;
}

export const DEFAULT_PORT = 45455;

export const FileHop = {
  getDeviceInfo: () => native().getDeviceInfo(),
  pickFiles: () => native().pickFiles(),
  openFile: (uri: string, mime: string) => native().openFile(uri, mime),

  async startReceiving(displayName: string) {
    await ensureLegacyStoragePermission();
    return native().startReceiving(displayName);
  },
  stopReceiving: () => Native?.stopReceiving(),
  respondToIncoming: (transferId: string, accept: boolean) =>
    native().respondToIncoming(transferId, accept),

  startDiscovery: () => native().startDiscovery(),
  stopDiscovery: () => Native?.stopDiscovery(),
  sendFiles: (
    device: Pick<NearbyDevice, 'host' | 'port'>,
    senderName: string,
    files: PickedFile[],
  ) => native().sendFiles(device.host, device.port, senderName, files),
  cancelTransfer: (transferId: string) => Native?.cancelTransfer(transferId),
};

export const FileHopEvents = {
  onDevice: (cb: (d: NearbyDevice) => void): EmitterSubscription =>
    DeviceEventEmitter.addListener('FileHopDevice', cb),
  onIncoming: (cb: (r: IncomingRequest) => void): EmitterSubscription =>
    DeviceEventEmitter.addListener('FileHopIncoming', cb),
  onState: (cb: (e: TransferStateEvent) => void): EmitterSubscription =>
    DeviceEventEmitter.addListener('FileHopTransferState', cb),
  onProgress: (cb: (e: ProgressEvent) => void): EmitterSubscription =>
    DeviceEventEmitter.addListener('FileHopProgress', cb),
  onFileReceived: (cb: (f: ReceivedFile) => void): EmitterSubscription =>
    DeviceEventEmitter.addListener('FileHopFileReceived', cb),
};

/** Android 9 and below write straight into Downloads, which needs a runtime grant. */
async function ensureLegacyStoragePermission() {
  if (Platform.OS !== 'android' || Number(Platform.Version) >= 29) {
    return;
  }
  const result = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
  );
  if (result !== PermissionsAndroid.RESULTS.GRANTED) {
    throw new Error('FileHop needs storage access to save received files.');
  }
}

/** Accepts "192.168.1.20" or "192.168.1.20:45455". */
export function parseManualAddress(
  text: string,
): Pick<NearbyDevice, 'host' | 'port'> | null {
  const match = text.trim().match(/^(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{1,5}))?$/);
  if (!match) {
    return null;
  }
  const port = match[2] ? Number(match[2]) : DEFAULT_PORT;
  if (port < 1 || port > 65535) {
    return null;
  }
  return { host: match[1], port };
}
