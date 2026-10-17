package dev.centinela.pantalla

import android.content.Context

object Prefs {
    private const val FILE = "centinela"
    private const val ENABLED = "enabled"
    private const val ADDRESS = "address"
    private const val HA_URL = "ha_url"
    private const val HA_TOKEN = "ha_token"

    fun enabled(context: Context): Boolean =
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE).getBoolean(ENABLED, false)

    fun setEnabled(context: Context, on: Boolean) {
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putBoolean(ENABLED, on).apply()
    }

    fun address(context: Context): String? =
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE).getString(ADDRESS, null)

    fun setAddress(context: Context, address: String?) {
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putString(ADDRESS, address).apply()
    }

    fun haUrl(context: Context): String =
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE).getString(HA_URL, "").orEmpty()

    fun setHaUrl(context: Context, url: String) {
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putString(HA_URL, url.trim()).apply()
    }

    fun haToken(context: Context): String =
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE).getString(HA_TOKEN, "").orEmpty()

    fun setHaToken(context: Context, token: String) {
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit().putString(HA_TOKEN, token.trim()).apply()
    }
}
