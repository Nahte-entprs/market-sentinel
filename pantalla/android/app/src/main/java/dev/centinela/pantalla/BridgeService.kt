package dev.centinela.pantalla

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

class BridgeService : Service() {
    private val listener: (StatusHub.Snapshot) -> Unit = { snap ->
        val nm = getSystemService(NotificationManager::class.java)
        nm.notify(NOTIF_ID, notification(snap.text))
    }

    override fun onCreate() {
        super.onCreate()
        BleLink.init(application)
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, getString(R.string.channel_name), NotificationManager.IMPORTANCE_LOW).apply {
                description = getString(R.string.channel_desc)
            },
        )
        startFg("Conectando con la pantalla")
        StatusHub.listen(listener)
        BleLink.kick()
        TapePoller.start(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        BleLink.kick()
        return START_STICKY
    }

    override fun onDestroy() {
        StatusHub.unlisten(listener)
        TapePoller.stop()
        BleLink.stop()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun startFg(text: String) {
        val note = notification(text)
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(NOTIF_ID, note, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
        } else {
            startForeground(NOTIF_ID, note)
        }
    }

    private fun notification(text: String): Notification {
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat)
            .setContentTitle("Centinela pantalla")
            .setContentText(text)
            .setOngoing(true)
            .build()
    }

    companion object {
        private const val CHANNEL = "bridge"
        private const val NOTIF_ID = 7
    }
}
