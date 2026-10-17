package dev.centinela.pantalla

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.LinkedHashSet

object QueueStore {
    private const val MAX = 80
    private val lock = Any()
    private val items = ArrayDeque<Outbound>()
    private val seen = LinkedHashSet<String>()
    private var loaded = false

    fun enqueue(context: Context, key: String, item: Outbound): Boolean {
        synchronized(lock) {
            load(context)
            if (!seen.add(key)) return false
            if (items.any { it.id == item.id }) return false
            while (seen.size > 200) {
                val first = seen.first()
                seen.remove(first)
            }
            items.addLast(item)
            while (items.size > MAX) items.removeFirst()
            save(context)
            return true
        }
    }

    fun peek(context: Context): Outbound? {
        synchronized(lock) {
            load(context)
            return items.firstOrNull()
        }
    }

    fun remove(context: Context, id: String) {
        synchronized(lock) {
            load(context)
            items.removeAll { it.id == id }
            save(context)
        }
    }

    fun size(context: Context): Int {
        synchronized(lock) {
            load(context)
            return items.size
        }
    }

    private fun load(context: Context) {
        if (loaded) return
        loaded = true
        val file = file(context)
        if (!file.exists()) return
        try {
            val array = JSONArray(file.readText())
            for (i in 0 until array.length()) {
                items.addLast(Outbound.fromJson(array.getJSONObject(i)))
            }
        } catch (_: Exception) {
            items.clear()
        }
    }

    private fun save(context: Context) {
        val array = JSONArray()
        for (item in items) {
            array.put(
                JSONObject()
                    .put("id", item.id)
                    .put("section", item.section)
                    .put("title", item.title)
                    .put("message", item.message)
                    .put("at", item.at),
            )
        }
        file(context).writeText(array.toString())
    }

    private fun file(context: Context) = File(context.filesDir, "queue.json")
}
