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

    Function("stop") {
      val context = appContext.reactContext ?: return@Function
      context.stopService(Intent(context, BuildKeepAliveService::class.java))
    }
  }
}
