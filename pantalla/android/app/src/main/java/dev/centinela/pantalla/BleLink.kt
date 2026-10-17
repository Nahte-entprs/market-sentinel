package dev.centinela.pantalla

import android.annotation.SuppressLint
import android.app.Application
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.BluetoothStatusCodes
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import androidx.core.content.ContextCompat
import java.util.UUID

@SuppressLint("MissingPermission")
object BleLink {
    private val nus = UUID.fromString("6e400001-b5a3-f393-e0a9-e50e24dcca9e")
    private val nusRx = UUID.fromString("6e400002-b5a3-f393-e0a9-e50e24dcca9e")
    private val nusTx = UUID.fromString("6e400003-b5a3-f393-e0a9-e50e24dcca9e")
    private val cccd = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")

    private lateinit var app: Application
    private val thread = HandlerThread("centinela-ble")
    private val handler by lazy { Handler(thread.looper) }
    private var started = false
    private var want = false
    private var gatt: BluetoothGatt? = null
    private var rx: BluetoothGattCharacteristic? = null
    private var mtu = 23
    private var ready = false
    private var discovered = false
    private var writing = false
    private var chunks: List<ByteArray> = emptyList()
    private var chunkIndex = 0
    private var inflight: Outbound? = null
    private var retries = 0
    private var scanning = false
    private val quotes = ArrayDeque<String>()

    private val reconnect = Runnable { connectIfNeeded() }
    private val ackTimeout = Runnable { if (writing) retryOrDrop() }
    private val discoverFallback = Runnable {
        if (!discovered) gatt?.discoverServices()
    }

    fun init(application: Application) {
        if (started) return
        started = true
        app = application
        thread.start()
    }

    fun kick() {
        handler.post {
            want = true
            connectIfNeeded()
        }
    }

    fun stop() {
        handler.post {
            want = false
            handler.removeCallbacks(reconnect)
            handler.removeCallbacks(ackTimeout)
            stopScan()
            closeGatt()
            publish("Puente apagado")
        }
    }

    fun scan() {
        handler.post { startScan() }
    }

    fun forget() {
        handler.post {
            Prefs.setAddress(app, null)
            closeGatt()
            publish("Pantalla olvidada")
            if (want) handler.postDelayed(reconnect, 500)
        }
    }

    fun onQueued() {
        handler.post {
            publish(null)
            pump()
        }
    }

    fun pushQuotes(lines: List<String>) {
        handler.post {
            quotes.clear()
            quotes.addAll(lines)
            pump()
        }
    }

    private fun connectIfNeeded() {
        if (!want) return
        if (ready || gatt != null) return
        val address = Prefs.address(app)
        if (address.isNullOrBlank()) {
            startScan()
            return
        }
        connect(address)
    }

    private fun adapter(): BluetoothAdapter? {
        val manager = app.getSystemService(BluetoothManager::class.java)
        return manager?.adapter
    }

    private fun startScan() {
        val bt = adapter()
        if (bt == null || !bt.isEnabled) {
            publish("Bluetooth apagado")
            return
        }
        if (!canScan()) {
            publish("Falta permiso de Bluetooth")
            return
        }
        if (scanning) return
        scanning = true
        publish("Buscando pantalla")
        val settings = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
        try {
            bt.bluetoothLeScanner?.startScan(null, settings, scanCallback)
        } catch (_: SecurityException) {
            scanning = false
            publish("Falta permiso de Bluetooth")
            return
        }
        handler.postDelayed({ stopScan() }, 10000)
    }

    private fun stopScan() {
        if (!scanning) return
        scanning = false
        try {
            adapter()?.bluetoothLeScanner?.stopScan(scanCallback)
        } catch (_: SecurityException) {
        }
    }

    private val scanCallback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            val name = result.scanRecord?.deviceName ?: ""
            val hit = name == "Centinela" || result.scanRecord?.serviceUuids?.any { it.uuid == nus } == true
            if (!hit) return
            handler.post {
                stopScan()
                Prefs.setAddress(app, result.device.address)
                publish("Pantalla encontrada")
                if (want) connect(result.device.address)
            }
        }
    }

    private fun connect(address: String) {
        val bt = adapter()
        if (bt == null || !bt.isEnabled) {
            publish("Bluetooth apagado")
            return
        }
        if (!canConnect()) {
            publish("Falta permiso de Bluetooth")
            return
        }
        closeGatt()
        val device = bt.getRemoteDevice(address)
        publish("Conectando")
        try {
            gatt = device.connectGatt(
                app,
                false,
                gattCallback,
                BluetoothDevice.TRANSPORT_LE,
                BluetoothDevice.PHY_LE_1M_MASK,
                handler,
            )
        } catch (_: SecurityException) {
            publish("Falta permiso de Bluetooth")
        }
    }

    private fun closeGatt() {
        handler.removeCallbacks(ackTimeout)
        handler.removeCallbacks(discoverFallback)
        ready = false
        discovered = false
        writing = false
        inflight = null
        val current = gatt
        gatt = null
        rx = null
        if (current == null) return
        try {
            current.disconnect()
        } catch (_: SecurityException) {
        }
        try {
            current.close()
        } catch (_: SecurityException) {
        }
    }

    private val gattCallback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
                mtu = 23
                discovered = false
                gatt.requestMtu(517)
                handler.postDelayed(discoverFallback, 2000)
                return
            }
            handler.post {
                closeGatt()
                if (want) {
                    publish("Sin pantalla, reintento")
                    handler.postDelayed(reconnect, 4000)
                }
            }
        }

        override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
            if (status == BluetoothGatt.GATT_SUCCESS) this@BleLink.mtu = mtu.coerceAtLeast(23)
            if (!discovered) gatt.discoverServices()
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                closeGatt()
                if (want) handler.postDelayed(reconnect, 4000)
                return
            }
            discovered = true
            handler.removeCallbacks(discoverFallback)
            val service = gatt.getService(nus)
            val write = service?.getCharacteristic(nusRx)
            val notify = service?.getCharacteristic(nusTx)
            if (service == null || write == null || notify == null) {
                publish("La pantalla no tiene el servicio")
                closeGatt()
                return
            }
            rx = write
            gatt.setCharacteristicNotification(notify, true)
            val desc = notify.getDescriptor(cccd)
            if (desc == null) {
                ready = true
                publish("Conectado")
                pump()
                return
            }
            if (Build.VERSION.SDK_INT >= 33) {
                gatt.writeDescriptor(desc, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
            } else {
                @Suppress("DEPRECATION")
                desc.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                @Suppress("DEPRECATION")
                gatt.writeDescriptor(desc)
            }
        }

        override fun onDescriptorWrite(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
            ready = status == BluetoothGatt.GATT_SUCCESS
            publish(if (ready) "Conectado" else "No pude suscribirme")
            if (ready) pump()
        }

        override fun onCharacteristicWrite(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
            if (status != BluetoothGatt.GATT_SUCCESS) {
                retryOrDrop()
                return
            }
            chunkIndex++
            if (chunkIndex < chunks.size) writeChunk()
            else handler.postDelayed(ackTimeout, 1500)
        }

        override fun onCharacteristicChanged(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            value: ByteArray,
        ) {
            onAck(value)
        }

        @Deprecated("API 32")
        override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            @Suppress("DEPRECATION")
            onAck(characteristic.value ?: return)
        }
    }

    private fun onAck(value: ByteArray) {
        if (!writing) return
        val text = value.toString(Charsets.UTF_8).trim()
        if (!text.startsWith("ok") && !text.startsWith("err")) return
        handler.removeCallbacks(ackTimeout)
        val id = inflight?.id
        writing = false
        inflight = null
        retries = 0
        if (id != null) QueueStore.remove(app, id)
        publish("Conectado")
        pump()
    }

    private fun pump() {
        if (!ready || writing) return
        val next = QueueStore.peek(app)
        val bytes = if (next != null) {
            next.jsonLine().toByteArray(Charsets.UTF_8)
        } else {
            val line = quotes.removeFirstOrNull() ?: return
            line.toByteArray(Charsets.UTF_8)
        }
        chunks = slice(bytes)
        chunkIndex = 0
        inflight = next
        retries = 0
        writing = true
        writeChunk()
    }

    private fun writeChunk() {
        val link = gatt
        val characteristic = rx
        if (link == null || characteristic == null || chunkIndex !in chunks.indices) {
            writing = false
            return
        }
        val chunk = chunks[chunkIndex]
        val started = try {
            if (Build.VERSION.SDK_INT >= 33) {
                link.writeCharacteristic(characteristic, chunk, BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT) ==
                    BluetoothStatusCodes.SUCCESS
            } else {
                @Suppress("DEPRECATION")
                characteristic.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                @Suppress("DEPRECATION")
                characteristic.value = chunk
                @Suppress("DEPRECATION")
                link.writeCharacteristic(characteristic)
            }
        } catch (_: SecurityException) {
            false
        }
        if (!started) retryOrDrop()
    }

    private fun retryOrDrop() {
        handler.removeCallbacks(ackTimeout)
        if (retries < 1 && ready) {
            retries++
            chunkIndex = 0
            writeChunk()
            return
        }
        writing = false
        inflight = null
        closeGatt()
        if (want) handler.postDelayed(reconnect, 2000)
    }

    private fun slice(bytes: ByteArray): List<ByteArray> {
        val size = (mtu - 3).coerceIn(20, 512)
        val out = ArrayList<ByteArray>()
        var i = 0
        while (i < bytes.size) {
            val end = (i + size).coerceAtMost(bytes.size)
            out.add(bytes.copyOfRange(i, end))
            i = end
        }
        return out.ifEmpty { listOf(byteArrayOf()) }
    }

    private fun publish(text: String?) {
        val shown = text ?: StatusHub.current.text
        StatusHub.post(shown, Prefs.address(app).orEmpty(), QueueStore.size(app))
    }

    private fun canScan(): Boolean {
        if (Build.VERSION.SDK_INT < 31) return true
        return granted(android.Manifest.permission.BLUETOOTH_SCAN)
    }

    private fun canConnect(): Boolean {
        if (Build.VERSION.SDK_INT < 31) return true
        return granted(android.Manifest.permission.BLUETOOTH_CONNECT)
    }

    private fun granted(permission: String): Boolean =
        ContextCompat.checkSelfPermission(app, permission) == PackageManager.PERMISSION_GRANTED
}
