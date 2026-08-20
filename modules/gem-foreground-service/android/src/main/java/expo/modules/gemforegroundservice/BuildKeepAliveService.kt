package expo.modules.gemforegroundservice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * This service does no work of its own — it exists purely to hold
 * FOREGROUND priority for the app process during the narrow window
 * between persisting an upload and confirming the GitHub Actions run
 * was dispatched (see buildPipeline.ts / buildKeepAlive.ts). Android is
 * dramatically less likely to kill a foreground-priority process than a
 * background one, which is the actual gap this closes: everything
 * before this existed relied on being able to recover *after* a kill,
 * not on preventing one during the riskiest few seconds.
 *
 * Stopped as soon as a GitHub run id is confirmed — after that point,
 * the resume logic in buildPipeline.ts is enough on its own.
 */
class BuildKeepAliveService : Service() {

  companion object {
    const val ACTION_START = "expo.modules.gemforegroundservice.START"
    const val ACTION_UPDATE = "expo.modules.gemforegroundservice.UPDATE"
    const val ACTION_PROGRESS = "expo.modules.gemforegroundservice.PROGRESS"
    const val EXTRA_TITLE = "title"
    const val EXTRA_MESSAGE = "message"
    const val EXTRA_PROGRESS_CURRENT = "progressCurrent"
    const val EXTRA_PROGRESS_MAX = "progressMax"
    const val EXTRA_PROGRESS_INDETERMINATE = "progressIndeterminate"
    private const val CHANNEL_ID = "gem_build_keepalive"
    private const val NOTIFICATION_ID = 4471
    private const val PREFS_NAME = "gem_foreground_service"
    private const val PREF_TITLE_KEY = "title"
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_UPDATE -> {
        val message = intent.getStringExtra(EXTRA_MESSAGE) ?: return START_STICKY
        ensureChannel()
        val notification = buildNotification(storedTitle(), message)
        (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(NOTIFICATION_ID, notification)
      }
      ACTION_PROGRESS -> {
        val message = intent.getStringExtra(EXTRA_MESSAGE) ?: return START_STICKY
        val current = intent.getIntExtra(EXTRA_PROGRESS_CURRENT, 0)
        val max = intent.getIntExtra(EXTRA_PROGRESS_MAX, 0)
        val indeterminate = intent.getBooleanExtra(EXTRA_PROGRESS_INDETERMINATE, false)
        ensureChannel()
        val notification = buildNotification(storedTitle(), message, current, max, indeterminate)
        (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify(NOTIFICATION_ID, notification)
      }
      else -> {
        val title = intent?.getStringExtra(EXTRA_TITLE) ?: "GEM"
        val message = intent?.getStringExtra(EXTRA_MESSAGE) ?: "Preparing build\u2026"
        setStoredTitle(title)
        ensureChannel()
        val notification = buildNotification(title, message)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        } else {
          startForeground(NOTIFICATION_ID, notification)
        }
      }
    }
    return START_STICKY
  }

  private fun storedTitle(): String =
    getSharedPreferences(PREFS_NAME, MODE_PRIVATE).getString(PREF_TITLE_KEY, "GEM") ?: "GEM"

  private fun setStoredTitle(title: String) {
    getSharedPreferences(PREFS_NAME, MODE_PRIVATE).edit().putString(PREF_TITLE_KEY, title).apply()
  }

  private fun ensureChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (manager.getNotificationChannel(CHANNEL_ID) == null) {
        val channel = NotificationChannel(CHANNEL_ID, "Build in progress", NotificationManager.IMPORTANCE_LOW)
        manager.createNotificationChannel(channel)
      }
    }
  }

  private fun buildNotification(
    title: String,
    message: String,
    progressCurrent: Int = 0,
    progressMax: Int = 0,
    progressIndeterminate: Boolean = false,
  ): Notification {
    val builder = NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle(title)
      .setContentText(message)
      .setSmallIcon(android.R.drawable.stat_sys_upload)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
    // progressMax == 0 (the ACTION_UPDATE/ACTION_START default) means "no
    // progress bar at all" - NotificationCompat only renders one when
    // setProgress is actually called, so this is safe to always evaluate.
    if (progressMax > 0 || progressIndeterminate) {
      builder.setProgress(progressMax, progressCurrent, progressIndeterminate)
    }
    return builder.build()
  }
}
