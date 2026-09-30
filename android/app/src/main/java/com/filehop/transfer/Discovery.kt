package com.filehop.transfer

import android.util.Log
import java.io.IOException
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetSocketAddress

private const val TAG = "FileHopDiscovery"

data class NearbyDevice(val id: String, val name: String, val host: String, val port: Int)

/** Receiver side: tells every phone on the network "I'm here, send to this port". */
class Announcer(deviceId: String, deviceName: String, port: Int) {
  private val payload =
    listOf(Protocol.ANNOUNCE_PREFIX, deviceId, deviceName.replace('|', ' '), port.toString())
      .joinToString("|")
      .toByteArray(Charsets.UTF_8)

  @Volatile private var running = false
  private var thread: Thread? = null

  fun start() {
    if (running) return
    running = true
    thread =
      Thread({
          try {
            DatagramSocket().use { socket ->
              socket.broadcast = true
              while (running) {
                // Re-read addresses each round: the user may switch Wi-Fi / hotspot while waiting.
                for (address in NetUtils.broadcastAddresses()) {
                  try {
                    socket.send(DatagramPacket(payload, payload.size, address, Protocol.DISCOVERY_PORT))
                  } catch (e: IOException) {
                    // Interface without a route (e.g. mobile data only) — try the next one.
                  }
                }
                Thread.sleep(Protocol.ANNOUNCE_INTERVAL_MS)
              }
            }
          } catch (e: InterruptedException) {
            // stop() requested.
          } catch (e: IOException) {
            Log.w(TAG, "Announcer stopped", e)
          }
        }, "FileHop-announce")
        .apply {
          isDaemon = true
          start()
        }
  }

  fun stop() {
    running = false
    thread?.interrupt()
    thread = null
  }
}

/** Sender side: listens for receiver announcements. */
class Scanner(private val ownDeviceId: String, private val onDevice: (NearbyDevice) -> Unit) {
  @Volatile private var socket: DatagramSocket? = null

  fun start() {
    if (socket != null) return
    val s =
      DatagramSocket(null).apply {
        reuseAddress = true
        broadcast = true
        bind(InetSocketAddress(Protocol.DISCOVERY_PORT))
      }
    socket = s
    Thread({
        val buffer = ByteArray(2048)
        while (!s.isClosed) {
          val packet = DatagramPacket(buffer, buffer.size)
          try {
            s.receive(packet)
          } catch (e: IOException) {
            break
          }
          parse(String(packet.data, 0, packet.length, Charsets.UTF_8), packet.address.hostAddress)
            ?.takeIf { it.id != ownDeviceId }
            ?.let(onDevice)
        }
      }, "FileHop-scan")
      .apply {
        isDaemon = true
        start()
      }
  }

  fun stop() {
    socket?.close()
    socket = null
  }

  private fun parse(message: String, host: String?): NearbyDevice? {
    val parts = message.split('|')
    if (host == null || parts.size != 4 || parts[0] != Protocol.ANNOUNCE_PREFIX) return null
    val port = parts[3].toIntOrNull() ?: return null
    return NearbyDevice(id = parts[1], name = parts[2], host = host, port = port)
  }
}
