package dev.centinela.pantalla

import android.content.Intent
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import androidx.core.content.ContextCompat

class NotifyListener : NotificationListenerService() {
    override fun onNotificationPosted(sbn: StatusBarNotification) {
        if (!Prefs.enabled(this)) return
        val item = NoticeParser.from(sbn) ?: return
        if (!QueueStore.enqueue(this, sbn.key, item)) return
        try {
            ContextCompat.startForegroundService(this, Intent(this, BridgeService::class.java))
        } catch (_: Exception) {
            // Android 12+ puede impedir arrancar el servicio desde segundo plano.
            // La cola queda guardada y sale cuando el puente vuelva a estar activo.
        }
        BleLink.onQueued()
    }
}
