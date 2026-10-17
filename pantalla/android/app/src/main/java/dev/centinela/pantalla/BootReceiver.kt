package dev.centinela.pantalla

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.content.ContextCompat

class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED) return
        if (!Prefs.enabled(context)) return
        ContextCompat.startForegroundService(context, Intent(context, BridgeService::class.java))
    }
}
