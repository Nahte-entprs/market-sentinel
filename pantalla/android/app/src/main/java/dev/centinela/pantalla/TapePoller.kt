package dev.centinela.pantalla

import android.content.Context
import android.os.Handler
import android.os.HandlerThread
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

object TapePoller {
    private const val EVERY_MS = 20_000L
    private val thread = HandlerThread("centinela-tape")
    private val handler by lazy { Handler(thread.looper) }
    private var started = false
    private var app: Context? = null

    private val tick = object : Runnable {
        override fun run() {
            fetch()
            handler.postDelayed(this, EVERY_MS)
        }
    }

    fun start(context: Context) {
        app = context.applicationContext
        if (!started) {
            started = true
            thread.start()
        }
        handler.removeCallbacks(tick)
        handler.post(tick)
    }

    fun stop() {
        if (!started) return
        handler.removeCallbacks(tick)
    }

    private fun fetch() {
        BleLink.pushClock()
        val context = app ?: return
        val base = Prefs.haUrl(context).trimEnd('/')
        val token = Prefs.haToken(context)
        if (base.isEmpty() || token.isEmpty()) return
        val url = "$base/api/states/sensor.centinela_tape"
        try {
            val conn = (URL(url).openConnection() as HttpURLConnection).apply {
                requestMethod = "GET"
                connectTimeout = 8000
                readTimeout = 8000
                setRequestProperty("Authorization", "Bearer $token")
                setRequestProperty("Accept", "application/json")
            }
            val code = conn.responseCode
            val body = (if (code in 200..299) conn.inputStream else conn.errorStream)
                ?.bufferedReader()?.use { it.readText() }
                .orEmpty()
            conn.disconnect()
            if (code !in 200..299) return
            val rows = JSONObject(body).optJSONObject("attributes")?.optJSONArray("rows") ?: return
            val lines = ArrayList<String>(rows.length())
            for (i in 0 until rows.length()) {
                val row = rows.optJSONObject(i) ?: continue
                val symbol = row.optString("s")
                if (symbol.isBlank()) continue
                val obj = JSONObject()
                obj.put("op", "quote")
                obj.put("symbol", symbol)
                obj.put("price", row.optString("p"))
                obj.put("chg", row.optString("c"))
                obj.put("vol", row.optString("v"))
                val px = row.optJSONArray("px")
                val vl = row.optJSONArray("vl")
                if (px != null) obj.put("px", px)
                if (vl != null) obj.put("vl", vl)
                lines.add(obj.toString() + "\n")
            }
            if (lines.isNotEmpty()) BleLink.pushQuotes(lines)
        } catch (_: Exception) {
        }
    }
}
