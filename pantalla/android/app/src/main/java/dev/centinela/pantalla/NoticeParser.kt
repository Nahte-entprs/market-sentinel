package dev.centinela.pantalla

import android.app.Notification
import android.service.notification.StatusBarNotification
import java.time.Instant

object NoticeParser {
    private const val COMPANION = "io.homeassistant.companion.android"
    private val section = Regex("centinela-(radar|cartera|reddit|ideas)")

    fun from(sbn: StatusBarNotification): Outbound? {
        if (sbn.packageName != COMPANION) return null
        val n = sbn.notification ?: return null
        if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return null

        val blob = listOfNotNull(n.group, sbn.groupKey, sbn.tag, n.channelId).joinToString(" ")
        val match = section.find(blob)
        val tag = sbn.tag ?: ""
        if (match == null && !tag.startsWith("centinela")) return null

        val title = n.extras?.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim().orEmpty()
        val text = n.extras?.getCharSequence(Notification.EXTRA_TEXT)?.toString()?.trim().orEmpty()
        val big = n.extras?.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()?.trim().orEmpty()
        val message = if (big.length > text.length) big else text
        if (title.isEmpty() && message.isEmpty()) return null

        val hash = sbn.key.hashCode().toUInt().toString(16).padStart(8, '0')
        val id = (hash + sbn.postTime.toString(16)).take(23)
        return Outbound(
            id = id,
            section = match?.groupValues?.get(1) ?: "radar",
            title = truncate(title.ifEmpty { "Aviso" }, 80),
            message = truncate(message, 180),
            at = Instant.now().toString(),
        )
    }

    private fun truncate(value: String, maxChars: Int): String {
        if (value.length <= maxChars) return value
        return value.take(maxChars - 1).trimEnd() + "…"
    }
}
