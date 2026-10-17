package dev.centinela.pantalla

import org.json.JSONObject

data class Outbound(
    val id: String,
    val section: String,
    val title: String,
    val message: String,
    val at: String,
) {
    fun jsonLine(): String {
        var body = message
        var line: String
        do {
            val obj = JSONObject()
            obj.put("id", id)
            obj.put("section", section)
            obj.put("title", title)
            obj.put("message", body)
            obj.put("at", at)
            line = obj.toString() + "\n"
            if (line.toByteArray(Charsets.UTF_8).size <= 700 || body.isEmpty()) break
            body = body.dropLast(16).trimEnd()
        } while (true)
        return line
    }

    companion object {
        fun fromJson(obj: JSONObject): Outbound {
            return Outbound(
                id = obj.getString("id"),
                section = obj.getString("section"),
                title = obj.getString("title"),
                message = obj.optString("message"),
                at = obj.optString("at"),
            )
        }
    }
}
