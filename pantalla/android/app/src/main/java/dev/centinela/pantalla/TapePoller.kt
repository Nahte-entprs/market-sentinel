package dev.centinela.pantalla

import android.content.Context
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.PowerManager
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

object TapePoller {
    private const val EVERY_MS = 10_000L
    private val thread = HandlerThread("centinela-tape")
    private val handler by lazy { Handler(thread.looper) }
    private var started = false
    private var app: Context? = null
    private var wake: PowerManager.WakeLock? = null
    private var wifi: WifiManager.WifiLock? = null

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
        holdAwake(context.applicationContext)
        handler.post(tick)
    }

    fun stop() {
        if (!started) return
        handler.removeCallbacks(tick)
        releaseAwake()
    }

    private fun holdAwake(context: Context) {
        if (wake?.isHeld != true) {
            val pm = context.getSystemService(PowerManager::class.java) ?: return
            wake = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "centinela:tape").apply {
                setReferenceCounted(false)
                acquire()
            }
        }
        if (wifi?.isHeld == true) return
        val wm = context.getSystemService(WifiManager::class.java) ?: return
        val mode = if (Build.VERSION.SDK_INT >= 29) {
            WifiManager.WIFI_MODE_FULL_LOW_LATENCY
        } else {
            @Suppress("DEPRECATION")
            WifiManager.WIFI_MODE_FULL_HIGH_PERF
        }
        wifi = wm.createWifiLock(mode, "centinela:tape").apply {
            setReferenceCounted(false)
            acquire()
        }
    }

    private fun releaseAwake() {
        wake?.let { if (it.isHeld) it.release() }
        wake = null
        wifi?.let { if (it.isHeld) it.release() }
        wifi = null
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
                if (row.has("t0")) obj.put("t0", row.optLong("t0"))
                if (row.has("t1")) obj.put("t1", row.optLong("t1"))
                if (row.optDouble("lv", 0.0) > 0) obj.put("lv", row.optDouble("lv"))
                val idx = row.optJSONArray("i")
                val px = row.optJSONArray("px")
                val vl = row.optJSONArray("vl")
                val va = row.optJSONArray("va")
                if (idx != null) obj.put("i", idx)
                if (px != null) obj.put("px", px)
                if (vl != null) obj.put("vl", vl)
                if (va != null) obj.put("va", va)
                lines.add(obj.toString() + "\n")
            }
            if (lines.isNotEmpty()) BleLink.pushQuotes(lines)
        } catch (_: Exception) {
        }
    }
}
