package expo.modules.gemforegroundservice

import android.content.Intent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class GemForegroundServiceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("GemForegroundService")

    Function("start") { title: String, message: String ->
      val context = appContext.reactContext ?: return@Function
      val intent = Intent(context, BuildKeepAliveService::class.java).apply {
        action = BuildKeepAliveService.ACTION_START
        putExtra(BuildKeepAliveService.EXTRA_TITLE, title)
        putExtra(BuildKeepAliveService.EXTRA_MESSAGE, message)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    Function("updateMessage") { message: String ->
      val context = appContext.reactContext ?: return@Function
      val intent = Intent(context, BuildKeepAliveService::class.java).apply {
        action = BuildKeepAliveService.ACTION_UPDATE
        putExtra(BuildKeepAliveService.EXTRA_MESSAGE, message)
      }
      context.startService(intent)
    }

    // current/max as raw byte counts (or any consistent unit) - Android
    // renders the actual progress bar; pass current == max == 0 to fall
    // back to an indeterminate spinner-style bar, useful for the extraction
    // step where total size isn't known upfront.
    Function("updateProgress") { message: String, current: Int, max: Int ->
      val context = appContext.reactContext ?: return@Function
      val indeterminate = max <= 0
      val intent = Intent(context, BuildKeepAliveService::class.java).apply {
        action = BuildKeepAliveService.ACTION_PROGRESS
        putExtra(BuildKeepAliveService.EXTRA_MESSAGE, message)
        putExtra(BuildKeepAliveService.EXTRA_PROGRESS_CURRENT, current)
        putExtra(BuildKeepAliveService.EXTRA_PROGRESS_MAX, max)
        putExtra(BuildKeepAliveService.EXTRA_PROGRESS_INDETERMINATE, indeterminate)
      }
      context.startService(intent)
    }

    Function("stop") {
      val context = appContext.reactContext ?: return@Function null
      context.stopService(Intent(context, BuildKeepAliveService::class.java))
    }
  }
}
