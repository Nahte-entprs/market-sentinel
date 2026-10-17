package dev.centinela.pantalla

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.widget.doAfterTextChanged
import dev.centinela.pantalla.databinding.ActivityMainBinding

class MainActivity : AppCompatActivity() {
    private lateinit var binding: ActivityMainBinding
    private val listener: (StatusHub.Snapshot) -> Unit = { snap ->
        binding.statusText.text = snap.text
        binding.deviceText.text = if (snap.address.isBlank()) "Sin pantalla elegida" else snap.address
        binding.queueText.text = "En cola: ${snap.queued}"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        BleLink.init(application)

        binding.haUrl.setText(Prefs.haUrl(this))
        binding.haToken.setText(Prefs.haToken(this))
        binding.haUrl.doAfterTextChanged { Prefs.setHaUrl(this, it?.toString().orEmpty()) }
        binding.haToken.doAfterTextChanged { Prefs.setHaToken(this, it?.toString().orEmpty()) }
        binding.bridgeSwitch.isChecked = Prefs.enabled(this)
        binding.bridgeSwitch.setOnCheckedChangeListener { _, on ->
            Prefs.setEnabled(this, on)
            val intent = Intent(this, BridgeService::class.java)
            if (on) ContextCompat.startForegroundService(this, intent) else stopService(intent)
        }
        binding.notifButton.setOnClickListener {
            startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        }
        binding.scanButton.setOnClickListener {
            ensurePerms()
            BleLink.scan()
        }
        binding.forgetButton.setOnClickListener { BleLink.forget() }
        ensurePerms()
    }

    override fun onStart() {
        super.onStart()
        StatusHub.listen(listener)
        binding.notifButton.text = if (listenerOn()) {
            "Notificaciones: activo"
        } else {
            "Acceso a notificaciones"
        }
    }

    override fun onStop() {
        StatusHub.unlisten(listener)
        super.onStop()
    }

    private fun listenerOn(): Boolean {
        val flat = Settings.Secure.getString(contentResolver, "enabled_notification_listeners") ?: return false
        return flat.contains(packageName)
    }

    private fun ensurePerms() {
        val need = mutableListOf<String>()
        if (Build.VERSION.SDK_INT >= 31) {
            if (!granted(Manifest.permission.BLUETOOTH_CONNECT)) need += Manifest.permission.BLUETOOTH_CONNECT
            if (!granted(Manifest.permission.BLUETOOTH_SCAN)) need += Manifest.permission.BLUETOOTH_SCAN
        }
        if (Build.VERSION.SDK_INT >= 33 && !granted(Manifest.permission.POST_NOTIFICATIONS)) {
            need += Manifest.permission.POST_NOTIFICATIONS
        }
        if (need.isNotEmpty()) ActivityCompat.requestPermissions(this, need.toTypedArray(), 1)
    }

    private fun granted(permission: String): Boolean =
        ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED
}
