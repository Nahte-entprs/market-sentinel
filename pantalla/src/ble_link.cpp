#include "ble_link.h"

#include "config.h"
#include "line_asm.h"

#include <Arduino.h>
#include <NimBLEDevice.h>
#include <string.h>

static const char *NUS_SVC = "6E400001-b5a3-f393-e0a9-e50e24dcca9e";
static const char *NUS_RX = "6E400002-b5a3-f393-e0a9-e50e24dcca9e";
static const char *NUS_TX = "6E400003-b5a3-f393-e0a9-e50e24dcca9e";

static NimBLECharacteristic *tx = nullptr;
static volatile bool connected = false;
static LineAsm assembler;
static QueueHandle_t lines = nullptr;

class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer *server, NimBLEConnInfo &info) override {
    connected = true;
    Serial.printf("[ble] conectado %s\n", info.getAddress().toString().c_str());
    server->updateConnParams(info.getConnHandle(), 24, 48, 0, 400);
    NimBLEDevice::getAdvertising()->stop();
  }

  void onDisconnect(NimBLEServer *, NimBLEConnInfo &, int reason) override {
    connected = false;
    line_asm_reset(assembler);
    Serial.printf("[ble] corto (%d), vuelvo a anunciar\n", reason);
    NimBLEDevice::startAdvertising();
  }

  void onMTUChange(uint16_t mtu, NimBLEConnInfo &) override { Serial.printf("[ble] mtu %u\n", mtu); }
};

class RxCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite(NimBLECharacteristic *chr, NimBLEConnInfo &) override {
    NimBLEAttValue value = chr->getValue();
    const uint8_t *data = value.data();
    size_t n = value.size();
    size_t off = 0;
    while (off < n) {
      char line[LINE_ASM_CAP];
      size_t used = 0;
      bool got = line_asm_push(assembler, data + off, n - off, used, line, sizeof line);
      if (used == 0) break;
      off += used;
      if (!got) break;
      if (lines) xQueueSend(lines, line, 0);
    }
  }
};

static ServerCallbacks server_cb;
static RxCallbacks rx_cb;

void ble_begin() {
  line_asm_reset(assembler);
  lines = xQueueCreate(4, LINE_ASM_CAP);
  NimBLEDevice::init(BLE_NAME);
  NimBLEDevice::setMTU(517);
  NimBLEDevice::setPower(9);

  NimBLEServer *server = NimBLEDevice::createServer();
  server->setCallbacks(&server_cb);
  NimBLEService *svc = server->createService(NUS_SVC);
  NimBLECharacteristic *rx = svc->createCharacteristic(NUS_RX, NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
  rx->setCallbacks(&rx_cb);
  tx = svc->createCharacteristic(NUS_TX, NIMBLE_PROPERTY::NOTIFY);
  svc->start();

  NimBLEAdvertising *adv = NimBLEDevice::getAdvertising();
  adv->setName(BLE_NAME);
  adv->addServiceUUID(svc->getUUID());
  adv->enableScanResponse(true);
  adv->start();
  Serial.println("[ble] anunciando Centinela");
}

bool ble_connected() { return connected; }

bool ble_take_line(char *out, size_t cap) {
  if (!lines || cap == 0) return false;
  char tmp[LINE_ASM_CAP];
  if (xQueueReceive(lines, tmp, 0) != pdTRUE) return false;
  strncpy(out, tmp, cap - 1);
  out[cap - 1] = 0;
  return true;
}

void ble_ack(const char *text) {
  if (!tx || !connected || !text) return;
  tx->setValue((const uint8_t *)text, strlen(text));
  tx->notify();
}
