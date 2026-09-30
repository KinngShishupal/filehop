package com.filehop.transfer

/**
 * Wire protocol shared by sender and receiver.
 *
 * Discovery: receivers broadcast a UDP datagram every second on [DISCOVERY_PORT]:
 *   FILEHOP1|<deviceId>|<deviceName>|<tcpPort>
 *
 * Transfer (one TCP connection per batch, sender connects to receiver):
 *   sender   -> MAGIC, VERSION(u8), manifestLength(i32), manifest JSON (UTF-8)
 *   receiver -> ACCEPT | DECLINE (u8)
 *   sender   -> raw bytes of every file, back to back, exactly `size` bytes each
 *   receiver -> DONE (u8) once everything is safely written
 */
object Protocol {
  const val DISCOVERY_PORT = 45454
  const val TRANSFER_PORT = 45455
  const val ANNOUNCE_PREFIX = "FILEHOP1"
  const val ANNOUNCE_INTERVAL_MS = 1000L

  val MAGIC = byteArrayOf('F'.code.toByte(), 'H'.code.toByte(), 'O'.code.toByte(), 'P'.code.toByte())
  const val VERSION = 1

  const val ACCEPT = 1
  const val DECLINE = 0
  const val DONE = 2

  const val MAX_MANIFEST_BYTES = 4 * 1024 * 1024
  const val ACCEPT_TIMEOUT_MS = 60_000L
  const val CONNECT_TIMEOUT_MS = 5_000

  /** Copy buffer: large enough that per-call overhead is negligible next to Wi-Fi throughput. */
  const val COPY_BUFFER_BYTES = 1024 * 1024
  /** Kernel socket buffers: lets the TCP window grow so fast Wi-Fi links stay saturated. */
  const val SOCKET_BUFFER_BYTES = 4 * 1024 * 1024

  const val PROGRESS_INTERVAL_MS = 200L
}
