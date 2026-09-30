package com.filehop.transfer

import android.content.Context
import android.net.Uri
import android.os.SystemClock
import android.util.Log
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.EOFException
import java.io.FileNotFoundException
import java.io.IOException
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.SocketException
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import org.json.JSONArray
import org.json.JSONObject

private const val TAG = "FileHopTransfer"

enum class Direction(val js: String) { SEND("send"), RECEIVE("receive") }

object TransferState {
  const val CONNECTING = "connecting"
  const val WAITING = "waiting" // sender: waiting for the receiver to accept
  const val TRANSFERRING = "transferring"
  const val COMPLETED = "completed"
  const val DECLINED = "declined"
  const val FAILED = "failed"
  const val CANCELLED = "cancelled"

  val TERMINAL = setOf(COMPLETED, DECLINED, FAILED, CANCELLED)
}

data class FileEntry(val name: String, val size: Long, val mime: String)

data class OutgoingFile(val uri: Uri, val entry: FileEntry)

data class ProgressSnapshot(
  val transferId: String,
  val direction: Direction,
  val bytesDone: Long,
  val totalBytes: Long,
  val fileIndex: Int,
  val fileCount: Int,
  val fileName: String,
  val bytesPerSecond: Double,
  val elapsedMs: Long,
)

interface TransferListener {
  fun onIncoming(transferId: String, senderName: String, host: String, files: List<FileEntry>)
  fun onState(transferId: String, direction: Direction, state: String, error: String? = null)
  fun onProgress(progress: ProgressSnapshot)
  fun onFileReceived(transferId: String, index: Int, entry: FileEntry, uri: Uri, mime: String)
}

/** Throttles progress events and keeps a smoothed speed estimate. */
private class ProgressTracker(
  private val transferId: String,
  private val direction: Direction,
  private val files: List<FileEntry>,
  private val listener: TransferListener,
) {
  private val totalBytes = files.sumOf { it.size }
  private val startedAt = SystemClock.elapsedRealtime()
  private var bytesDone = 0L
  private var lastEmitAt = 0L
  private var windowStartedAt = startedAt
  private var windowBytes = 0L
  private var smoothedSpeed = 0.0

  fun add(bytes: Int, fileIndex: Int) {
    bytesDone += bytes
    windowBytes += bytes
    val now = SystemClock.elapsedRealtime()
    if (now - lastEmitAt >= Protocol.PROGRESS_INTERVAL_MS) emit(fileIndex, now)
  }

  fun emit(fileIndex: Int, now: Long = SystemClock.elapsedRealtime()) {
    val windowMs = now - windowStartedAt
    if (windowMs >= 500) {
      val instant = windowBytes * 1000.0 / windowMs
      smoothedSpeed = if (smoothedSpeed == 0.0) instant else smoothedSpeed * 0.6 + instant * 0.4
      windowStartedAt = now
      windowBytes = 0
    }
    val elapsed = now - startedAt
    val speed = if (smoothedSpeed > 0) smoothedSpeed else if (elapsed > 0) bytesDone * 1000.0 / elapsed else 0.0
    lastEmitAt = now
    val index = fileIndex.coerceIn(0, (files.size - 1).coerceAtLeast(0))
    listener.onProgress(
      ProgressSnapshot(
        transferId, direction, bytesDone, totalBytes, index, files.size,
        files.getOrNull(index)?.name ?: "", speed, elapsed,
      )
    )
  }

  /** Final event reports the true average speed over the whole transfer. */
  fun finish() {
    val elapsed = (SystemClock.elapsedRealtime() - startedAt).coerceAtLeast(1)
    smoothedSpeed = bytesDone * 1000.0 / elapsed
    windowBytes = 0
    windowStartedAt = SystemClock.elapsedRealtime()
    emit(files.size - 1)
  }
}

class TransferEngine(private val context: Context, private val listener: TransferListener) {
  private val executor = Executors.newCachedThreadPool()
  private val sockets = ConcurrentHashMap<String, Socket>()
  private val cancelled = ConcurrentHashMap.newKeySet<String>()
  private val pendingDecisions = ConcurrentHashMap<String, CompletableFuture<Boolean>>()
  private val receiving = ConcurrentHashMap.newKeySet<String>()
  @Volatile private var serverSocket: ServerSocket? = null

  // ---------------------------------------------------------------- receiving

  /** Starts listening for senders. Returns the TCP port actually bound. */
  @Synchronized
  fun startServer(): Int {
    serverSocket?.let { return it.localPort }
    val server = bindServer(Protocol.TRANSFER_PORT) ?: bindServer(0) ?: throw IOException("Could not open a port")
    serverSocket = server
    executor.execute {
      while (!server.isClosed) {
        val socket =
          try {
            server.accept()
          } catch (e: IOException) {
            break
          }
        executor.execute { handleIncoming(socket) }
      }
    }
    return server.localPort
  }

  private fun bindServer(port: Int): ServerSocket? =
    try {
      ServerSocket().apply {
        reuseAddress = true
        // Must be set before bind so the advertised TCP window can exceed 64 KB.
        receiveBufferSize = Protocol.SOCKET_BUFFER_BYTES
        bind(InetSocketAddress(port))
      }
    } catch (e: IOException) {
      null
    }

  @Synchronized
  fun stopServer() {
    serverSocket?.close()
    serverSocket = null
    // Leaving receive mode also stops anything still arriving.
    receiving.toList().forEach(::cancel)
  }

  fun respondToIncoming(transferId: String, accept: Boolean) {
    pendingDecisions.remove(transferId)?.complete(accept)
  }

  private fun handleIncoming(socket: Socket) {
    val transferId = UUID.randomUUID().toString()
    sockets[transferId] = socket
    receiving.add(transferId)
    var announced = false
    try {
      socket.tcpNoDelay = true
      val input = DataInputStream(socket.getInputStream())
      val output = DataOutputStream(socket.getOutputStream())

      val magic = ByteArray(Protocol.MAGIC.size)
      input.readFully(magic)
      if (!magic.contentEquals(Protocol.MAGIC)) throw IOException("Not a FileHop sender")
      val version = input.readUnsignedByte()
      if (version != Protocol.VERSION) throw IOException("Sender uses an incompatible FileHop version")
      val manifestLength = input.readInt()
      if (manifestLength !in 1..Protocol.MAX_MANIFEST_BYTES) throw IOException("Invalid manifest")
      val manifestBytes = ByteArray(manifestLength)
      input.readFully(manifestBytes)
      val (senderName, files) = parseManifest(String(manifestBytes, Charsets.UTF_8))

      val decision = CompletableFuture<Boolean>()
      pendingDecisions[transferId] = decision
      announced = true
      listener.onIncoming(transferId, senderName, socket.inetAddress?.hostAddress ?: "", files)
      val accepted =
        try {
          decision.get(Protocol.ACCEPT_TIMEOUT_MS, TimeUnit.MILLISECONDS)
        } catch (e: TimeoutException) {
          false
        } finally {
          pendingDecisions.remove(transferId)
        }
      output.writeByte(if (accepted) Protocol.ACCEPT else Protocol.DECLINE)
      output.flush()
      if (!accepted) {
        listener.onState(transferId, Direction.RECEIVE, TransferState.DECLINED)
        return
      }

      listener.onState(transferId, Direction.RECEIVE, TransferState.TRANSFERRING)
      val progress = ProgressTracker(transferId, Direction.RECEIVE, files, listener)
      val buffer = ByteArray(Protocol.COPY_BUFFER_BYTES)
      files.forEachIndexed { index, entry ->
        val target = FileStore.create(context, entry.name, entry.mime)
        var success = false
        try {
          target.output.use { out ->
            var remaining = entry.size
            while (remaining > 0) {
              val read = input.read(buffer, 0, minOf(buffer.size.toLong(), remaining).toInt())
              if (read < 0) throw EOFException("Sender disconnected")
              out.write(buffer, 0, read)
              remaining -= read
              progress.add(read, index)
            }
          }
          success = true
        } finally {
          target.finish(success)
        }
        listener.onFileReceived(transferId, index, entry, target.uri, target.mime)
      }
      output.writeByte(Protocol.DONE)
      output.flush()
      progress.finish()
      listener.onState(transferId, Direction.RECEIVE, TransferState.COMPLETED)
    } catch (e: Exception) {
      Log.w(TAG, "Receive $transferId ended", e)
      // Connections that never got as far as a valid request (port scans, etc.) stay silent.
      if (announced) reportFailure(transferId, Direction.RECEIVE, e)
    } finally {
      finishSocket(transferId, socket)
    }
  }

  private fun parseManifest(json: String): Pair<String, List<FileEntry>> {
    val root = JSONObject(json)
    val array = root.getJSONArray("files")
    if (array.length() == 0 || array.length() > 10_000) throw IOException("Invalid file list")
    val files =
      (0 until array.length()).map { i ->
        val item = array.getJSONObject(i)
        val size = item.getLong("size")
        if (size < 0) throw IOException("Invalid file size")
        FileEntry(FileStore.sanitizeName(item.getString("name")), size, item.optString("mime"))
      }
    return root.optString("sender", "Unknown device").take(100) to files
  }

  // ------------------------------------------------------------------ sending

  fun send(host: String, port: Int, senderName: String, files: List<OutgoingFile>): String =
    send(senderName, files, connectAttempts = 1) { InetSocketAddress(host, port) }

  /**
   * [resolve] runs on the transfer thread after CONNECTING is reported, so it may block (e.g. while
   * joining a Wi-Fi Direct group). Extra [connectAttempts] cover links whose IP isn't ready yet.
   */
  fun send(
    senderName: String,
    files: List<OutgoingFile>,
    connectAttempts: Int,
    resolve: () -> InetSocketAddress,
  ): String {
    val transferId = UUID.randomUUID().toString()
    executor.execute { runSend(transferId, senderName, files, connectAttempts, resolve) }
    return transferId
  }

  fun hasActiveTransfers() = sockets.isNotEmpty()

  private fun runSend(
    transferId: String,
    senderName: String,
    files: List<OutgoingFile>,
    connectAttempts: Int,
    resolve: () -> InetSocketAddress,
  ) {
    var socket = Socket()
    sockets[transferId] = socket
    try {
      listener.onState(transferId, Direction.SEND, TransferState.CONNECTING)
      val address = resolve()
      if (cancelled.contains(transferId)) throw SocketException("Cancelled")
      var attempt = 1
      while (true) {
        try {
          socket.sendBufferSize = Protocol.SOCKET_BUFFER_BYTES
          socket.tcpNoDelay = true
          socket.connect(address, Protocol.CONNECT_TIMEOUT_MS)
          break
        } catch (e: IOException) {
          if (attempt++ >= connectAttempts || cancelled.contains(transferId)) throw e
          Thread.sleep(1_000)
          socket.close()
          socket = Socket()
          sockets[transferId] = socket
        }
      }
      val output = DataOutputStream(socket.getOutputStream())
      val input = DataInputStream(socket.getInputStream())

      val manifest =
        JSONObject()
          .put("sender", senderName)
          .put(
            "files",
            JSONArray().apply {
              files.forEach { f ->
                put(JSONObject().put("name", f.entry.name).put("size", f.entry.size).put("mime", f.entry.mime))
              }
            },
          )
          .toString()
          .toByteArray(Charsets.UTF_8)
      output.write(Protocol.MAGIC)
      output.writeByte(Protocol.VERSION)
      output.writeInt(manifest.size)
      output.write(manifest)
      output.flush()

      listener.onState(transferId, Direction.SEND, TransferState.WAITING)
      socket.soTimeout = (Protocol.ACCEPT_TIMEOUT_MS + 5_000).toInt()
      if (input.readUnsignedByte() != Protocol.ACCEPT) {
        listener.onState(transferId, Direction.SEND, TransferState.DECLINED)
        return
      }
      socket.soTimeout = 0

      listener.onState(transferId, Direction.SEND, TransferState.TRANSFERRING)
      val entries = files.map { it.entry }
      val progress = ProgressTracker(transferId, Direction.SEND, entries, listener)
      val buffer = ByteArray(Protocol.COPY_BUFFER_BYTES)
      val resolver = context.contentResolver
      files.forEachIndexed { index, file ->
        val source = resolver.openInputStream(file.uri) ?: throw FileNotFoundException("Can't read ${file.entry.name}")
        source.use { stream ->
          var remaining = file.entry.size
          while (remaining > 0) {
            val read = stream.read(buffer, 0, minOf(buffer.size.toLong(), remaining).toInt())
            if (read < 0) throw IOException("${file.entry.name} changed while sending")
            output.write(buffer, 0, read)
            remaining -= read
            progress.add(read, index)
          }
        }
      }
      output.flush()

      // Wait until the receiver confirms everything hit its disk.
      socket.soTimeout = 60_000
      if (input.readUnsignedByte() != Protocol.DONE) throw IOException("Receiver did not confirm")
      progress.finish()
      listener.onState(transferId, Direction.SEND, TransferState.COMPLETED)
    } catch (e: Exception) {
      Log.w(TAG, "Send $transferId ended", e)
      reportFailure(transferId, Direction.SEND, e)
    } finally {
      finishSocket(transferId, socket)
    }
  }

  // ------------------------------------------------------------------- shared

  fun cancel(transferId: String) {
    cancelled.add(transferId)
    pendingDecisions.remove(transferId)?.complete(false)
    sockets[transferId]?.close()
  }

  fun shutdown() {
    stopServer()
    sockets.keys.forEach(::cancel)
    executor.shutdownNow()
  }

  private fun reportFailure(transferId: String, direction: Direction, error: Exception) {
    if (cancelled.contains(transferId)) {
      listener.onState(transferId, direction, TransferState.CANCELLED)
    } else {
      listener.onState(transferId, direction, TransferState.FAILED, friendlyMessage(error))
    }
  }

  private fun friendlyMessage(error: Exception): String =
    when (error) {
      is java.net.ConnectException -> "Couldn't reach the other phone. Keep FileHop open on its Receive screen and try again."
      is java.net.SocketTimeoutException -> "The other phone stopped responding."
      is EOFException -> "The other phone disconnected."
      is java.net.SocketException -> "Connection lost."
      else -> error.message ?: "Transfer failed."
    }

  private fun finishSocket(transferId: String, socket: Socket) {
    sockets.remove(transferId)
    receiving.remove(transferId)
    cancelled.remove(transferId)
    try {
      socket.close()
    } catch (e: IOException) {
      // Already closed.
    }
  }
}
