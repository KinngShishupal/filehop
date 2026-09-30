package com.filehop.transfer

import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.net.wifi.WpsInfo
import android.net.wifi.p2p.WifiP2pConfig
import android.net.wifi.p2p.WifiP2pGroup
import android.net.wifi.p2p.WifiP2pInfo
import android.net.wifi.p2p.WifiP2pManager
import android.net.wifi.p2p.nsd.WifiP2pDnsSdServiceInfo
import android.net.wifi.p2p.nsd.WifiP2pDnsSdServiceRequest
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import java.io.IOException
import java.net.InetAddress
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

private const val TAG = "FileHopDirect"

/**
 * Wi-Fi Direct fallback for phones that aren't on the same network.
 *
 * The receiver creates its own Wi-Fi Direct group (it becomes the group owner, usually 192.168.49.1)
 * and advertises a DNS-SD service carrying its id, name, TCP port and the group's credentials. The
 * sender finds that service, joins the group and then talks to the group owner with the normal
 * FileHop TCP protocol — [TransferEngine] doesn't know which link it's running over.
 *
 * Blocking methods ([startHosting], [stopHosting], [connect], [disconnect]) must run off the main
 * thread; the framework's callbacks are delivered on the main looper.
 */
@SuppressLint("MissingPermission") // Callers request NEARBY_WIFI_DEVICES / location first.
class WifiDirect(context: Context) {
  data class Peer(
    val id: String,
    val name: String,
    val port: Int,
    val deviceAddress: String,
    val networkName: String?,
    val passphrase: String?,
  )

  companion object {
    private const val SERVICE_INSTANCE = "FileHop"
    private const val SERVICE_TYPE = "_filehop._tcp"
    private const val OP_TIMEOUT_MS = 10_000L
    private const val PEER_TTL_MS = 30_000L
    private const val REDISCOVER_EVERY_TICKS = 12
    private const val LISTEN_REFRESH_MS = 15_000L
    private const val CONNECT_TIMEOUT_MS = 30_000L
  }

  private val appContext = context.applicationContext
  private val main = Handler(Looper.getMainLooper())
  private val manager = appContext.getSystemService(Context.WIFI_P2P_SERVICE) as WifiP2pManager?
  private val channel: WifiP2pManager.Channel? =
    try {
      manager?.initialize(appContext, Looper.getMainLooper(), null)
    } catch (e: Exception) {
      null
    }

  val isAvailable: Boolean
    get() =
      manager != null &&
        channel != null &&
        appContext.packageManager.hasSystemFeature(PackageManager.FEATURE_WIFI_DIRECT)

  // ----------------------------------------------------------------- receiver

  // Android (13+) switches Wi-Fi Direct off when idle and only switches it back on for calls that
  // need it (discoverPeers, createGroup, addLocalService, ...). Housekeeping calls such as
  // clearLocalServices, removeGroup or requestGroupInfo just fail while it's off, and turning it
  // off drops our group and advertisement. So hosting re-checks itself and rebuilds when needed.

  private val hostLock = Any()
  private val hostWorker = Executors.newSingleThreadScheduledExecutor()
  private var maintenance: ScheduledFuture<*>? = null
  @Volatile private var hosting = false
  private var ownsGroup = false
  private var advertisedGroup: String? = null
  private var hostArgs: Triple<String, String, Int>? = null
  private var quiet: () -> Boolean = { false }

  /** Creates a group and advertises this receiver. Returns false if Wi-Fi Direct couldn't start. */
  fun startHosting(deviceId: String, name: String, port: Int, isTransferring: () -> Boolean): Boolean {
    synchronized(hostLock) {
      if (manager == null || channel == null) return false
      hosting = true
      hostArgs = Triple(deviceId, name, port)
      quiet = isTransferring
      val ok = ensureHosted()
      maintenance?.cancel(false)
      maintenance =
        hostWorker.scheduleWithFixedDelay(::maintainHosting, LISTEN_REFRESH_MS, LISTEN_REFRESH_MS, TimeUnit.MILLISECONDS)
      return ok
    }
  }

  private fun maintainHosting() {
    synchronized(hostLock) {
      if (!hosting || quiet()) return
      ensureHosted()
    }
  }

  /** Makes sure our group exists and is advertised; keeps the owner discoverable. Holds [hostLock]. */
  private fun ensureHosted(): Boolean {
    val m = manager ?: return false
    val c = channel ?: return false
    val (deviceId, name, port) = hostArgs ?: return false
    return try {
      var group = groupInfo()
      if (group != null && !group.isGroupOwner) {
        runCatching { action { m.removeGroup(c, it) } }
        group = null
      }
      if (group == null) {
        advertisedGroup = null
        action { m.createGroup(c, it) } // Also switches Wi-Fi Direct on.
        ownsGroup = true
        group =
          waitFor(10_000) { groupInfo()?.takeIf { it.isGroupOwner && !it.passphrase.isNullOrEmpty() } }
            ?: throw IOException("Group didn't come up")
      }
      if (advertisedGroup != group.networkName) {
        val record =
          mapOf(
            "id" to deviceId,
            "name" to name.take(60),
            "port" to port.toString(),
            "ssid" to (group.networkName ?: ""),
            "pass" to (group.passphrase ?: ""),
          )
        runCatching { action { m.clearLocalServices(c, it) } }
        action {
          m.addLocalService(c, WifiP2pDnsSdServiceInfo.newInstance(SERVICE_INSTANCE, SERVICE_TYPE, record), it)
        }
        advertisedGroup = group.networkName
        Log.i(TAG, "Hosting Wi-Fi Direct group ${group.networkName}")
      }
      // Stay in listen mode so senders' service queries get answered.
      runCatching { action { m.discoverPeers(c, it) } }
      true
    } catch (e: Exception) {
      Log.w(TAG, "Wi-Fi Direct hosting unavailable", e)
      false
    }
  }

  fun stopHosting() {
    synchronized(hostLock) {
      if (!hosting) return
      hosting = false
      maintenance?.cancel(false)
      maintenance = null
      advertisedGroup = null
      val m = manager ?: return
      val c = channel ?: return
      runCatching { action { m.clearLocalServices(c, it) } }
      runCatching { action { m.stopPeerDiscovery(c, it) } }
      if (ownsGroup) {
        ownsGroup = false
        runCatching { action { m.removeGroup(c, it) } }
      }
    }
  }

  // ------------------------------------------------------------------- sender

  private class Seen(val peer: Peer, val at: Long)

  private val peers = ConcurrentHashMap<String, Seen>()
  private var scanning = false
  private var ownId = ""
  private var onPeer: ((Peer) -> Unit)? = null
  private var ticks = 0
  @Volatile private var connecting = false
  @Volatile private var joined = false

  /** Re-emits known peers every second (JS drops silent devices) and re-runs discovery now and then. */
  private val tick =
    object : Runnable {
      override fun run() {
        if (!scanning) return
        val cutoff = SystemClock.elapsedRealtime() - PEER_TTL_MS
        peers.values.forEach { seen ->
          // Discovery is paused while connected, so don't let the peer we're talking to expire.
          if (seen.at >= cutoff || connecting || joined) onPeer?.invoke(seen.peer)
        }
        if (ticks++ % REDISCOVER_EVERY_TICKS == 0 && !connecting && !joined) discover()
        main.postDelayed(this, 1_000)
      }
    }

  fun startScanning(ownDeviceId: String, onPeer: (Peer) -> Unit) {
    val m = manager ?: return
    val c = channel ?: return
    main.post {
      if (scanning) return@post
      scanning = true
      ownId = ownDeviceId
      this.onPeer = onPeer
      ticks = 0
      try {
        m.setDnsSdResponseListeners(
          c,
          { _, _, _ -> },
          { fullDomain, txt, device -> onRecord(fullDomain, txt, device?.deviceAddress) },
        )
      } catch (e: Exception) {
        Log.w(TAG, "Wi-Fi Direct discovery unavailable", e)
        scanning = false
        return@post
      }
      main.post(tick)
    }
  }

  fun stopScanning() {
    main.post {
      if (!scanning) return@post
      scanning = false
      onPeer = null
      main.removeCallbacks(tick)
      val m = manager ?: return@post
      m.clearServiceRequests(channel, null)
      m.stopPeerDiscovery(channel, null)
    }
  }

  fun peer(id: String): Peer? = peers[id]?.peer

  private fun onRecord(fullDomain: String?, txt: Map<String, String>?, deviceAddress: String?) {
    if (fullDomain == null || txt == null || deviceAddress == null) return
    if (!fullDomain.lowercase().contains(SERVICE_TYPE)) return
    val id = txt["id"] ?: return
    val port = txt["port"]?.toIntOrNull() ?: return
    if (id == ownId) return
    val peer =
      Peer(
        id = id,
        name = txt["name"].orEmpty().ifBlank { "Nearby phone" },
        port = port,
        deviceAddress = deviceAddress,
        networkName = txt["ssid"]?.takeIf { it.isNotEmpty() },
        passphrase = txt["pass"]?.takeIf { it.isNotEmpty() },
      )
    if (peers.put(id, Seen(peer, SystemClock.elapsedRealtime())) == null) Log.i(TAG, "Found ${peer.name} over Wi-Fi Direct")
    onPeer?.invoke(peer)
  }

  private fun discover() {
    val m = manager ?: return
    val c = channel ?: return
    val request = WifiP2pDnsSdServiceRequest.newInstance(SERVICE_TYPE)
    // discoverPeers first: it's what switches an idle Wi-Fi Direct back on (see the receiver notes).
    // Each later step runs whether or not the previous one succeeded.
    m.discoverPeers(
      c,
      always("discoverPeers") {
        m.clearServiceRequests(
          c,
          always("clearServiceRequests") {
            m.addServiceRequest(
              c,
              request,
              always("addServiceRequest") { m.discoverServices(c, always("discoverServices") {}) },
            )
          },
        )
      },
    )
  }

  /** Joins [peer]'s group and returns the group owner's address. Blocks for up to ~30 s. */
  fun connect(peer: Peer): InetAddress {
    val m = manager ?: throw IOException("This phone doesn't support Wi-Fi Direct.")
    val c = channel ?: throw IOException("This phone doesn't support Wi-Fi Direct.")
    ownerAddressOf(peer)?.let { return it }
    connecting = true
    try {
      runCatching { action { m.stopPeerDiscovery(c, it) } }
      if (connectionInfo()?.groupFormed == true) {
        runCatching { action { m.removeGroup(c, it) } }
        Thread.sleep(500)
      }
      val config = configFor(peer)
      var attempt = 0
      while (true) {
        try {
          action { m.connect(c, config, it) }
          break
        } catch (e: IOException) {
          // BUSY is common right after discovery; give the radio a moment.
          if (++attempt >= 3) throw IOException("Couldn't connect to ${peer.name} over Wi-Fi Direct. Is Wi-Fi on?")
          Thread.sleep(1_500)
        }
      }
      joined = true
      return waitFor(CONNECT_TIMEOUT_MS) { ownerAddressOf(peer) }
        ?: throw IOException("${peer.name} didn't answer the Wi-Fi Direct connection.")
    } finally {
      connecting = false
    }
  }

  /** Leaves the group we joined as a sender (no-op otherwise). */
  fun disconnect() {
    if (!joined) return
    joined = false
    val m = manager ?: return
    val c = channel ?: return
    runCatching { action { m.removeGroup(c, it) } }
  }

  private fun configFor(peer: Peer): WifiP2pConfig {
    val ssid = peer.networkName
    val pass = peer.passphrase
    // Joining with the group's credentials skips the "accept connection?" prompt on the receiver.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && ssid != null && pass != null && pass.length >= 8) {
      try {
        return WifiP2pConfig.Builder().setNetworkName(ssid).setPassphrase(pass).build()
      } catch (e: IllegalArgumentException) {
        // Name/passphrase the builder won't take — fall back to a regular invitation.
      }
    }
    @Suppress("DEPRECATION")
    return WifiP2pConfig().apply {
      deviceAddress = peer.deviceAddress
      wps.setup = WpsInfo.PBC
      groupOwnerIntent = 0
    }
  }

  private fun ownerAddressOf(peer: Peer): InetAddress? {
    val info = connectionInfo() ?: return null
    if (!info.groupFormed || info.isGroupOwner) return null
    val group = groupInfo() ?: return null
    val sameGroup =
      group.owner?.deviceAddress.equals(peer.deviceAddress, ignoreCase = true) ||
        (peer.networkName != null && group.networkName == peer.networkName)
    return if (sameGroup) info.groupOwnerAddress else null
  }

  // ------------------------------------------------------------------ helpers

  private fun groupInfo(): WifiP2pGroup? =
    query<WifiP2pGroup> { cb -> manager!!.requestGroupInfo(channel) { cb(it) } }

  private fun connectionInfo(): WifiP2pInfo? =
    query<WifiP2pInfo> { cb -> manager!!.requestConnectionInfo(channel) { cb(it) } }

  private fun <T> query(block: ((T?) -> Unit) -> Unit): T? {
    val future = CompletableFuture<T?>()
    main.post {
      try {
        block { future.complete(it) }
      } catch (e: Exception) {
        future.complete(null)
      }
    }
    return try {
      future.get(3_000, TimeUnit.MILLISECONDS)
    } catch (e: Exception) {
      null
    }
  }

  /** Runs a framework call on the main thread and blocks until its ActionListener fires. */
  private fun action(block: (WifiP2pManager.ActionListener) -> Unit) {
    val future = CompletableFuture<Int>()
    val listener =
      object : WifiP2pManager.ActionListener {
        override fun onSuccess() {
          future.complete(-1)
        }

        override fun onFailure(reason: Int) {
          future.complete(reason)
        }
      }
    main.post {
      try {
        block(listener)
      } catch (e: SecurityException) {
        future.complete(WifiP2pManager.ERROR)
      }
    }
    val reason =
      try {
        future.get(OP_TIMEOUT_MS, TimeUnit.MILLISECONDS)
      } catch (e: Exception) {
        throw IOException("Wi-Fi Direct timed out")
      }
    if (reason != -1) throw IOException("Wi-Fi Direct error ${reasonName(reason)}")
  }

  private fun always(step: String, next: () -> Unit) =
    object : WifiP2pManager.ActionListener {
      override fun onSuccess() = next()

      override fun onFailure(reason: Int) {
        Log.d(TAG, "Discovery step $step failed: ${reasonName(reason)}")
        next()
      }
    }

  private fun <T> waitFor(timeoutMs: Long, probe: () -> T?): T? {
    val deadline = SystemClock.elapsedRealtime() + timeoutMs
    while (SystemClock.elapsedRealtime() < deadline) {
      probe()?.let { return it }
      Thread.sleep(400)
    }
    return null
  }

  private fun reasonName(reason: Int) =
    when (reason) {
      WifiP2pManager.P2P_UNSUPPORTED -> "UNSUPPORTED"
      WifiP2pManager.BUSY -> "BUSY"
      WifiP2pManager.NO_SERVICE_REQUESTS -> "NO_SERVICE_REQUESTS"
      else -> "ERROR($reason)"
    }
}
