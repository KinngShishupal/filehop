package com.filehop.transfer

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.net.wifi.WifiManager
import android.os.Build
import android.os.PowerManager
import android.provider.OpenableColumns
import android.provider.Settings
import android.view.WindowManager
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.bridge.WritableMap
import java.util.UUID
import java.util.concurrent.Executors

class FileHopModule(private val reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext), TransferListener {

  companion object {
    const val NAME = "FileHop"
    private const val PICK_REQUEST = 4517

    const val EVENT_DEVICE = "FileHopDevice"
    const val EVENT_INCOMING = "FileHopIncoming"
    const val EVENT_STATE = "FileHopTransferState"
    const val EVENT_PROGRESS = "FileHopProgress"
    const val EVENT_FILE_RECEIVED = "FileHopFileReceived"
  }

  private val engine = TransferEngine(reactContext, this)
  private val io = Executors.newSingleThreadExecutor()
  private val deviceId: String by lazy { loadDeviceId() }

  private var announcer: Announcer? = null
  private var scanner: Scanner? = null
  private var pickPromise: Promise? = null

  // Anything in here keeps Wi-Fi at full power, the CPU awake and the screen on.
  private val busyReasons = mutableSetOf<String>()
  private var wifiLock: WifiManager.WifiLock? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private var multicastLock: WifiManager.MulticastLock? = null

  private val activityListener =
    object : ActivityEventListener {
      override fun onActivityResult(activity: Activity, requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode != PICK_REQUEST) return
        val promise = pickPromise ?: return
        pickPromise = null
        if (resultCode != Activity.RESULT_OK || data == null) {
          promise.resolve(Arguments.createArray())
          return
        }
        val uris = mutableListOf<Uri>()
        val clip = data.clipData
        if (clip != null) {
          for (i in 0 until clip.itemCount) clip.getItemAt(i).uri?.let(uris::add)
        } else {
          data.data?.let(uris::add)
        }
        io.execute { promise.resolve(describeFiles(uris)) }
      }

      override fun onNewIntent(intent: Intent) = Unit
    }

  init {
    reactContext.addActivityEventListener(activityListener)
  }

  override fun getName() = NAME

  // ------------------------------------------------------------------ device

  @ReactMethod
  fun getDeviceInfo(promise: Promise) {
    promise.resolve(
      Arguments.createMap().apply {
        putString("id", deviceId)
        putString("name", deviceName())
        putArray("addresses", Arguments.fromList(NetUtils.localIpv4Addresses()))
      }
    )
  }

  private fun loadDeviceId(): String {
    val prefs = reactContext.getSharedPreferences("filehop", Context.MODE_PRIVATE)
    return prefs.getString("deviceId", null)
      ?: UUID.randomUUID().toString().also { prefs.edit().putString("deviceId", it).apply() }
  }

  private fun deviceName(): String {
    val userName =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N_MR1) {
        Settings.Global.getString(reactContext.contentResolver, Settings.Global.DEVICE_NAME)
      } else null
    if (!userName.isNullOrBlank()) return userName
    val model = Build.MODEL ?: "Android"
    val maker = Build.MANUFACTURER?.replaceFirstChar { it.uppercase() } ?: ""
    return if (model.startsWith(maker, ignoreCase = true)) model else "$maker $model".trim()
  }

  // ------------------------------------------------------------------- files

  @ReactMethod
  fun pickFiles(promise: Promise) {
    val activity = reactContext.currentActivity
    if (activity == null) {
      promise.reject("E_NO_ACTIVITY", "App is not in the foreground")
      return
    }
    if (pickPromise != null) {
      promise.reject("E_BUSY", "A file picker is already open")
      return
    }
    val intent =
      Intent(Intent.ACTION_GET_CONTENT).apply {
        type = "*/*"
        addCategory(Intent.CATEGORY_OPENABLE)
        putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
      }
    pickPromise = promise
    try {
      activity.startActivityForResult(Intent.createChooser(intent, "Choose files to send"), PICK_REQUEST)
    } catch (e: ActivityNotFoundException) {
      pickPromise = null
      promise.reject("E_NO_PICKER", "No file picker available", e)
    }
  }

  private fun describeFiles(uris: List<Uri>) =
    Arguments.createArray().apply {
      val resolver = reactContext.contentResolver
      for (uri in uris) {
        var name: String? = null
        var size = -1L
        try {
          resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
            if (c.moveToFirst()) {
              val nameIdx = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
              val sizeIdx = c.getColumnIndex(OpenableColumns.SIZE)
              if (nameIdx >= 0) name = c.getString(nameIdx)
              if (sizeIdx >= 0 && !c.isNull(sizeIdx)) size = c.getLong(sizeIdx)
            }
          }
          if (size < 0) size = resolver.openAssetFileDescriptor(uri, "r")?.use { it.length } ?: -1
        } catch (e: Exception) {
          // Unreadable entry — reported with size -1 so JS can tell the user.
        }
        val fileName = name ?: uri.lastPathSegment ?: "file"
        pushMap(
          Arguments.createMap().apply {
            putString("uri", uri.toString())
            putString("name", fileName)
            putDouble("size", size.toDouble())
            putString("mime", resolver.getType(uri) ?: FileStore.mimeFor(fileName, null))
          }
        )
      }
    }

  @ReactMethod
  fun openFile(uri: String, mime: String, promise: Promise) {
    val view =
      Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(Uri.parse(uri), mime)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
    try {
      reactContext.startActivity(
        Intent.createChooser(view, "Open with").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      )
      promise.resolve(null)
    } catch (e: ActivityNotFoundException) {
      promise.reject("E_NO_APP", "No app can open this file", e)
    }
  }

  // --------------------------------------------------------------- receiving

  @ReactMethod
  fun startReceiving(displayName: String, promise: Promise) {
    try {
      val port = engine.startServer()
      announcer?.stop()
      announcer = Announcer(deviceId, displayName, port).also { it.start() }
      setBusy("receive-mode", true)
      promise.resolve(
        Arguments.createMap().apply {
          putInt("port", port)
          putArray("addresses", Arguments.fromList(NetUtils.localIpv4Addresses()))
        }
      )
    } catch (e: Exception) {
      promise.reject("E_RECEIVE", e.message ?: "Could not start receiving", e)
    }
  }

  @ReactMethod
  fun stopReceiving() {
    announcer?.stop()
    announcer = null
    engine.stopServer()
    setBusy("receive-mode", false)
  }

  @ReactMethod
  fun respondToIncoming(transferId: String, accept: Boolean) = engine.respondToIncoming(transferId, accept)

  // ----------------------------------------------------------------- sending

  @ReactMethod
  fun startDiscovery(promise: Promise) {
    try {
      if (scanner == null) {
        acquireMulticastLock()
        scanner =
          Scanner(deviceId) { device ->
              emit(
                EVENT_DEVICE,
                Arguments.createMap().apply {
                  putString("id", device.id)
                  putString("name", device.name)
                  putString("host", device.host)
                  putInt("port", device.port)
                },
              )
            }
            .also { it.start() }
      }
      promise.resolve(null)
    } catch (e: Exception) {
      releaseMulticastLock()
      promise.reject("E_DISCOVERY", e.message ?: "Could not search for devices", e)
    }
  }

  @ReactMethod
  fun stopDiscovery() {
    scanner?.stop()
    scanner = null
    releaseMulticastLock()
  }

  @ReactMethod
  fun sendFiles(host: String, port: Int, senderName: String, files: ReadableArray, promise: Promise) {
    val outgoing =
      (0 until files.size()).mapNotNull { i ->
        val map = files.getMap(i) ?: return@mapNotNull null
        val name = map.getString("name") ?: "file"
        OutgoingFile(
          Uri.parse(map.getString("uri")),
          FileEntry(name, map.getDouble("size").toLong(), map.getString("mime") ?: FileStore.mimeFor(name, null)),
        )
      }
    if (outgoing.isEmpty() || outgoing.any { it.entry.size < 0 }) {
      promise.reject("E_FILES", "Some files can't be read")
      return
    }
    promise.resolve(engine.send(host, port, senderName, outgoing))
  }

  @ReactMethod
  fun cancelTransfer(transferId: String) = engine.cancel(transferId)

  // Required by NativeEventEmitter; events are delivered through DeviceEventEmitter.
  @ReactMethod fun addListener(eventName: String) = Unit

  @ReactMethod fun removeListeners(count: Double) = Unit

  // ------------------------------------------------------ TransferListener

  override fun onIncoming(transferId: String, senderName: String, host: String, files: List<FileEntry>) {
    setBusy(transferId, true)
    emit(
      EVENT_INCOMING,
      Arguments.createMap().apply {
        putString("transferId", transferId)
        putString("senderName", senderName)
        putString("host", host)
        putDouble("totalBytes", files.sumOf { it.size }.toDouble())
        putArray(
          "files",
          Arguments.createArray().apply {
            files.forEach { f ->
              pushMap(
                Arguments.createMap().apply {
                  putString("name", f.name)
                  putDouble("size", f.size.toDouble())
                  putString("mime", f.mime)
                }
              )
            }
          },
        )
      },
    )
  }

  override fun onState(transferId: String, direction: Direction, state: String, error: String?) {
    setBusy(transferId, state !in TransferState.TERMINAL)
    emit(
      EVENT_STATE,
      Arguments.createMap().apply {
        putString("transferId", transferId)
        putString("direction", direction.js)
        putString("state", state)
        if (error != null) putString("error", error)
      },
    )
  }

  override fun onProgress(progress: ProgressSnapshot) {
    emit(
      EVENT_PROGRESS,
      Arguments.createMap().apply {
        putString("transferId", progress.transferId)
        putString("direction", progress.direction.js)
        putDouble("bytesDone", progress.bytesDone.toDouble())
        putDouble("totalBytes", progress.totalBytes.toDouble())
        putInt("fileIndex", progress.fileIndex)
        putInt("fileCount", progress.fileCount)
        putString("fileName", progress.fileName)
        putDouble("bytesPerSecond", progress.bytesPerSecond)
        putDouble("elapsedMs", progress.elapsedMs.toDouble())
      },
    )
  }

  override fun onFileReceived(transferId: String, index: Int, entry: FileEntry, uri: Uri, mime: String) {
    emit(
      EVENT_FILE_RECEIVED,
      Arguments.createMap().apply {
        putString("transferId", transferId)
        putInt("index", index)
        putString("name", entry.name)
        putDouble("size", entry.size.toDouble())
        putString("mime", mime)
        putString("uri", uri.toString())
      },
    )
  }

  private fun emit(event: String, payload: WritableMap) {
    if (reactContext.hasActiveReactInstance()) reactContext.emitDeviceEvent(event, payload)
  }

  // ------------------------------------------------------------ power locks

  @Synchronized
  private fun setBusy(reason: String, busy: Boolean) {
    val wasBusy = busyReasons.isNotEmpty()
    if (busy) busyReasons.add(reason) else busyReasons.remove(reason)
    val isBusy = busyReasons.isNotEmpty()
    if (wasBusy == isBusy) return
    if (isBusy) acquirePowerLocks() else releasePowerLocks()
    UiThreadUtil.runOnUiThread {
      val window = reactContext.currentActivity?.window ?: return@runOnUiThread
      if (isBusy) window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
      else window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }
  }

  @Suppress("DEPRECATION")
  private fun acquirePowerLocks() {
    val wifi = reactContext.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    wifiLock =
      wifi.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "FileHop:wifi").apply {
        setReferenceCounted(false)
        acquire()
      }
    val power = reactContext.getSystemService(Context.POWER_SERVICE) as PowerManager
    wakeLock =
      power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "FileHop:transfer").apply {
        setReferenceCounted(false)
        acquire(6 * 60 * 60 * 1000L)
      }
  }

  private fun releasePowerLocks() {
    wifiLock?.takeIf { it.isHeld }?.release()
    wakeLock?.takeIf { it.isHeld }?.release()
    wifiLock = null
    wakeLock = null
  }

  private fun acquireMulticastLock() {
    if (multicastLock != null) return
    val wifi = reactContext.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
    multicastLock =
      wifi.createMulticastLock("FileHop:discovery").apply {
        setReferenceCounted(false)
        acquire()
      }
  }

  private fun releaseMulticastLock() {
    multicastLock?.takeIf { it.isHeld }?.release()
    multicastLock = null
  }

  override fun invalidate() {
    stopDiscovery()
    announcer?.stop()
    engine.shutdown()
    io.shutdownNow()
    synchronized(this) {
      busyReasons.clear()
      releasePowerLocks()
    }
    reactContext.removeActivityEventListener(activityListener)
    super.invalidate()
  }
}
