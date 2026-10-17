package dev.centinela.pantalla

import android.app.Application

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        BleLink.init(this)
    }
}
