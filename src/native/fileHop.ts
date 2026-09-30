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

/** `lan`: same Wi-Fi / hotspot. `direct`: found over Wi-Fi Direct, no shared network needed. */
export type Transport = 'lan' | 'direct';

export type NearbyDevice = {
  id: string;
  name: string;
  /** Empty for `direct` devices; the address is only known once connected. */
  host: string;
  port: number;
  transport: Transport;
};

export type SendTarget = Pick<NearbyDevice, 'host' | 'port'> &
  Partial<Pick<NearbyDevice, 'id' | 'transport'>>;

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
  isWifiEnabled(): Promise<boolean>;
  openWifiSettings(): void;
  startReceiving(
    displayName: string,
    useDirect: boolean,
  ): Promise<{ port: number; addresses: string[]; direct: boolean }>;
  stopReceiving(): void;
  respondToIncoming(transferId: string, accept: boolean): void;
  startDiscovery(useDirect: boolean): Promise<void>;
  stopDiscovery(): void;
  sendFiles(
    host: string,
    port: number,
    senderName: string,
    files: PickedFile[],
  ): Promise<string>;
  sendFilesDirect(
    deviceId: string,
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
  isWifiEnabled: () => native().isWifiEnabled(),
  openWifiSettings: () => Native?.openWifiSettings(),

  async startReceiving(displayName: string) {
    await ensureLegacyStoragePermission();
    const useDirect = await ensureWifiDirectPermission();
    return native().startReceiving(displayName, useDirect);
  },
  stopReceiving: () => Native?.stopReceiving(),
  respondToIncoming: (transferId: string, accept: boolean) =>
    native().respondToIncoming(transferId, accept),

  async startDiscovery() {
    const useDirect = await ensureWifiDirectPermission();
    return native().startDiscovery(useDirect);
  },
  stopDiscovery: () => Native?.stopDiscovery(),
  sendFiles: (device: SendTarget, senderName: string, files: PickedFile[]) =>
    device.transport === 'direct' && device.id
      ? native().sendFilesDirect(device.id, senderName, files)
      : native().sendFiles(device.host, device.port, senderName, files),
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

/**
 * Wi-Fi Direct needs NEARBY_WIFI_DEVICES (Android 13+) or precise location (older). If the user
 * says no, FileHop still works over a shared Wi-Fi / hotspot, so this never throws.
 */
async function ensureWifiDirectPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return false;
  }
  const { PERMISSIONS, RESULTS } = PermissionsAndroid;
  const wanted =
    Number(Platform.Version) >= 33
      ? [PERMISSIONS.NEARBY_WIFI_DEVICES]
      : [PERMISSIONS.ACCESS_FINE_LOCATION, PERMISSIONS.ACCESS_COARSE_LOCATION];
  try {
    const result = await PermissionsAndroid.requestMultiple(wanted);
    return result[wanted[0]] === RESULTS.GRANTED;
  } catch {
    return false;
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
