package com.filehop.transfer

import android.content.ContentValues
import android.content.Context
import android.media.MediaScannerConnection
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.webkit.MimeTypeMap
import androidx.core.content.FileProvider
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.OutputStream

/** A file being written into Downloads/FileHop. Call [finish] exactly once. */
class IncomingFile(val uri: Uri, val mime: String, val output: OutputStream, private val onFinish: (Boolean) -> Unit) {
  fun finish(success: Boolean) = onFinish(success)
}

object FileStore {
  const val FOLDER = "FileHop"

  /** Strips anything that could escape the target folder or break the filesystem. */
  fun sanitizeName(raw: String): String {
    val cleaned =
      raw.substringAfterLast('/')
        .substringAfterLast('\\')
        .replace(Regex("[\\u0000-\\u001f:*?\"<>|]"), "_")
        .trim()
        .trimStart('.')
    return cleaned.take(200).ifEmpty { "file" }
  }

  fun mimeFor(name: String, fallback: String?): String {
    val ext = name.substringAfterLast('.', "").lowercase()
    return MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext)
      ?: fallback?.takeIf { it.isNotBlank() }
      ?: "application/octet-stream"
  }

  fun create(context: Context, rawName: String, senderMime: String?): IncomingFile {
    val name = sanitizeName(rawName)
    // Prefer the extension-derived type so MediaStore never renames the file to match it.
    val mime = mimeFor(name, senderMime)
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) createInMediaStore(context, name, mime)
    else createLegacy(context, name, mime)
  }

  private fun createInMediaStore(context: Context, name: String, mime: String): IncomingFile {
    val resolver = context.contentResolver
    val values =
      ContentValues().apply {
        put(MediaStore.MediaColumns.DISPLAY_NAME, name)
        put(MediaStore.MediaColumns.MIME_TYPE, mime)
        put(MediaStore.MediaColumns.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/$FOLDER")
        put(MediaStore.MediaColumns.IS_PENDING, 1)
      }
    val uri =
      resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
        ?: throw IOException("Could not create $name in Downloads")
    val output =
      try {
        resolver.openOutputStream(uri) ?: throw IOException("Could not open $name for writing")
      } catch (e: Exception) {
        resolver.delete(uri, null, null)
        throw e
      }
    return IncomingFile(uri, mime, output) { success ->
      if (success) {
        resolver.update(uri, ContentValues().apply { put(MediaStore.MediaColumns.IS_PENDING, 0) }, null, null)
      } else {
        resolver.delete(uri, null, null)
      }
    }
  }

  @Suppress("DEPRECATION")
  private fun createLegacy(context: Context, name: String, mime: String): IncomingFile {
    val dir = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), FOLDER)
    if (!dir.exists() && !dir.mkdirs()) throw IOException("Could not create Downloads/$FOLDER")
    val file = uniqueFile(dir, name)
    val output = FileOutputStream(file)
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
    return IncomingFile(uri, mime, output) { success ->
      if (success) MediaScannerConnection.scanFile(context, arrayOf(file.absolutePath), arrayOf(mime), null)
      else file.delete()
    }
  }

  private fun uniqueFile(dir: File, name: String): File {
    var candidate = File(dir, name)
    if (!candidate.exists()) return candidate
    val base = name.substringBeforeLast('.', name)
    val ext = name.substringAfterLast('.', "").let { if (it.isEmpty()) "" else ".$it" }
    var i = 1
    while (candidate.exists()) candidate = File(dir, "$base (${i++})$ext")
    return candidate
  }
}
