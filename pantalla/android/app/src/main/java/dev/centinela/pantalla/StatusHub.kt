package dev.centinela.pantalla

import android.os.Handler
import android.os.Looper

object StatusHub {
    data class Snapshot(val text: String, val address: String, val queued: Int)

    private val main = Handler(Looper.getMainLooper())
    private val listeners = mutableListOf<(Snapshot) -> Unit>()
    @Volatile
    var current = Snapshot("Puente apagado", "", 0)
        private set

    fun post(text: String, address: String, queued: Int) {
        val snap = Snapshot(text, address, queued)
        current = snap
        main.post {
            listeners.toList().forEach { it(snap) }
        }
    }

    fun listen(listener: (Snapshot) -> Unit) {
        listeners += listener
        listener(current)
    }

    fun unlisten(listener: (Snapshot) -> Unit) {
        listeners -= listener
    }
}
