#pragma once

#include "wled.h"

// Only compile this usermod for ESP32 targets that support TWAI
#if defined(ESP32) && !defined(CONFIG_IDF_TARGET_ESP32C2)

#include "driver/twai.h"

// Ring buffer size for storing received CAN frames
#define CAN_FRAME_BUFFER_SIZE 32

// CAN Frame structure for storage
struct CANFrame {
  uint32_t id;
  uint8_t dlc;
  uint8_t data[8];
  bool extended;
  bool rtr;
  uint32_t timestamp_ms;
};

class UsermodCANTWAI : public Usermod {
  private:
    // Configuration variables
    bool enabled = false;
    bool initDone = false;
    bool twaiStarted = false;
    
    // CAN Configuration
    uint32_t bitrate = 500000;  // Default 500 kbps (common in automotive)
    int8_t rxPin = 4;           // Default RX GPIO
    int8_t txPin = 5;           // Default TX GPIO
    bool listenOnlyMode = true; // Start in receive-only mode for safety
    uint16_t rxQueueLen = 128;  // Increase RX queue to reduce overruns
    bool filterEnabled = false;
    bool filterExt = false;
    uint32_t filterId = 0;
    uint32_t filterMask = 0x7FF; // Standard 11-bit mask
    
    // Status tracking
    uint32_t framesReceived = 0;
    uint32_t framesTransmitted = 0;
    uint32_t busErrors = 0;
    uint32_t overruns = 0;
    uint32_t lastFrameTime = 0;
    
    // Ring buffer for storing frames
    CANFrame frameBuffer[CAN_FRAME_BUFFER_SIZE];
    uint8_t bufferHead = 0;
    uint8_t bufferTail = 0;
    uint8_t bufferCount = 0;
    
    // UI settings
    uint8_t uiPollRate = 2;       // 0=slow(1Hz), 1=normal(2Hz), 2=fast(5Hz)
    uint8_t uiEffect = 0;         // 0=None, 1=RPM Pulse, 2=Speed Sweep (placeholders)
    uint8_t uiFrameCount = 20;    // Number of frames to show in UI
    
    // String constants stored in PROGMEM
    static const char _name[];
    static const char _enabled[];
    static const char _bitrate[];
    static const char _rxPin[];
    static const char _txPin[];
    static const char _listenOnly[];
    static const char _uiPollRate[];
    static const char _uiEffect[];
    static const char _rxQueueLen[];
    static const char _filterEnabled[];
    static const char _filterExt[];
    static const char _filterId[];
    static const char _filterMask[];

    uint16_t clampQueueLen(uint16_t value) {
      if (value < 8) return 8;
      if (value > 256) return 256;
      return value;
    }

    twai_filter_config_t buildFilterConfig() {
      if (!filterEnabled) return TWAI_FILTER_CONFIG_ACCEPT_ALL();

      twai_filter_config_t f_config = {};
      f_config.single_filter = true;

      if (filterExt) {
        uint32_t id = filterId & 0x1FFFFFFF;
        uint32_t mask = filterMask & 0x1FFFFFFF;
        f_config.acceptance_code = (id << 3);
        f_config.acceptance_mask = ~(mask << 3);
      } else {
        uint32_t id = filterId & 0x7FF;
        uint32_t mask = filterMask & 0x7FF;
        f_config.acceptance_code = (id << 21);
        f_config.acceptance_mask = ~(mask << 21);
      }

      return f_config;
    }
    
    // Initialize TWAI driver
    bool initTWAI() {
      if (twaiStarted) {
        stopTWAI();
      }
      
      if (rxPin < 0 || txPin < 0) {
        DEBUG_PRINTLN(F("CAN: Invalid GPIO pins"));
        return false;
      }
      
      // General configuration
      twai_general_config_t g_config = TWAI_GENERAL_CONFIG_DEFAULT(
        (gpio_num_t)txPin, 
        (gpio_num_t)rxPin, 
        listenOnlyMode ? TWAI_MODE_LISTEN_ONLY : TWAI_MODE_NORMAL
      );
      rxQueueLen = clampQueueLen(rxQueueLen);
      g_config.rx_queue_len = rxQueueLen;
      g_config.alerts_enabled = TWAI_ALERT_RX_DATA | TWAI_ALERT_ERR_PASS | 
                                TWAI_ALERT_BUS_ERROR | TWAI_ALERT_RX_QUEUE_FULL;
      
      // Timing configuration based on bitrate
      twai_timing_config_t t_config;
      switch (bitrate) {
        case 1000000:
          t_config = TWAI_TIMING_CONFIG_1MBITS();
          break;
        case 800000:
          t_config = TWAI_TIMING_CONFIG_800KBITS();
          break;
        case 500000:
          t_config = TWAI_TIMING_CONFIG_500KBITS();
          break;
        case 250000:
          t_config = TWAI_TIMING_CONFIG_250KBITS();
          break;
        case 125000:
          t_config = TWAI_TIMING_CONFIG_125KBITS();
          break;
        case 100000:
          t_config = TWAI_TIMING_CONFIG_100KBITS();
          break;
        case 50000:
          t_config = TWAI_TIMING_CONFIG_50KBITS();
          break;
        case 25000:
          t_config = TWAI_TIMING_CONFIG_25KBITS();
          break;
        default:
          t_config = TWAI_TIMING_CONFIG_500KBITS(); // Fallback to 500k
          DEBUG_PRINTLN(F("CAN: Invalid bitrate, using 500kbps"));
      }
      
      // Filter configuration
      twai_filter_config_t f_config = buildFilterConfig();
      
      // Install TWAI driver
      esp_err_t ret = twai_driver_install(&g_config, &t_config, &f_config);
      if (ret != ESP_OK) {
        DEBUG_PRINTF("CAN: Failed to install TWAI driver: %d\n", ret);
        return false;
      }
      
      // Start TWAI driver
      ret = twai_start();
      if (ret != ESP_OK) {
        DEBUG_PRINTF("CAN: Failed to start TWAI driver: %d\n", ret);
        twai_driver_uninstall();
        return false;
      }
      
      twaiStarted = true;
      DEBUG_PRINTLN(F("CAN: TWAI driver started successfully"));
      return true;
    }
    
    // Stop TWAI driver
    void stopTWAI() {
      if (twaiStarted) {
        twai_stop();
        twai_driver_uninstall();
        twaiStarted = false;
        DEBUG_PRINTLN(F("CAN: TWAI driver stopped"));
      }
    }
    
    // Add frame to ring buffer
    void addFrameToBuffer(const twai_message_t& msg) {
      CANFrame& frame = frameBuffer[bufferHead];
      
      frame.id = msg.identifier;
      frame.dlc = msg.data_length_code;
      frame.extended = msg.extd;
      frame.rtr = msg.rtr;
      frame.timestamp_ms = millis();
      
      for (int i = 0; i < msg.data_length_code && i < 8; i++) {
        frame.data[i] = msg.data[i];
      }
      
      bufferHead = (bufferHead + 1) % CAN_FRAME_BUFFER_SIZE;
      
      if (bufferCount < CAN_FRAME_BUFFER_SIZE) {
        bufferCount++;
      } else {
        // Buffer full, overwrite oldest
        bufferTail = (bufferTail + 1) % CAN_FRAME_BUFFER_SIZE;
        overruns++;
      }
    }
    
    // Read CAN frames (non-blocking)
    void readCANFrames() {
      if (!twaiStarted) return;
      
      uint32_t alerts;
      if (twai_read_alerts(&alerts, 0) == ESP_OK) {
        if (alerts & TWAI_ALERT_ERR_PASS) {
          busErrors++;
        }
        if (alerts & TWAI_ALERT_BUS_ERROR) {
          busErrors++;
        }
        if (alerts & TWAI_ALERT_RX_QUEUE_FULL) {
          overruns++;
        }
      }
      
      // Read all available frames
      twai_message_t message;
      while (twai_receive(&message, 0) == ESP_OK) {
        framesReceived++;
        lastFrameTime = millis();
        addFrameToBuffer(message);
      }
    }
    
  public:
    // Called once at boot
    void setup() override {
      DEBUG_PRINTLN(F("CAN: Usermod setup"));
      
      if (enabled && rxPin >= 0 && txPin >= 0) {
        if (initTWAI()) {
          DEBUG_PRINTLN(F("CAN: Initialization successful"));
        } else {
          DEBUG_PRINTLN(F("CAN: Initialization failed"));
          enabled = false;
        }
      }
      
      initDone = true;
    }
    
    // Called continuously
    void loop() override {
      if (!enabled || !twaiStarted) return;
      
      readCANFrames();
    }
    
    // Add info to JSON /info endpoint
    void addToJsonInfo(JsonObject& root) override {
      JsonObject user = root["u"];
      if (user.isNull()) user = root.createNestedObject("u");
      
      JsonObject can = user.createNestedObject(F("CAN Bus"));
      
      if (enabled && twaiStarted) {
        can[F("Status")] = F("Running");
        can[F("Mode")] = listenOnlyMode ? F("Listen-Only") : F("Normal");
        
        JsonArray bitrateArr = can.createNestedArray(F("Bitrate"));
        bitrateArr.add(bitrate / 1000);
        bitrateArr.add(F(" kbps"));
        
        JsonArray rxArr = can.createNestedArray(F("RX Frames"));
        rxArr.add(framesReceived);
        
        if (framesReceived > 0) {
          JsonArray lastArr = can.createNestedArray(F("Last Frame"));
          lastArr.add((millis() - lastFrameTime) / 1000);
          lastArr.add(F(" sec ago"));
        }
        
        if (busErrors > 0) {
          JsonArray errArr = can.createNestedArray(F("Bus Errors"));
          errArr.add(busErrors);
        }
        
        if (overruns > 0) {
          JsonArray overArr = can.createNestedArray(F("Overruns"));
          overArr.add(overruns);
        }
      } else if (enabled) {
        can[F("Status")] = F("Error - Failed to start");
      } else {
        can[F("Status")] = F("Disabled");
      }
    }
    
    // Add CAN data to JSON state
    void addToJsonState(JsonObject& root) override {
      const bool canLite = root[F("canLite")] | false;
      JsonObject can = root.createNestedObject(F("can"));
      can[F("enabled")] = enabled;
      can[F("started")] = twaiStarted;
      can[F("bitrate")] = bitrate;
      can[F("rxPin")] = rxPin;
      can[F("txPin")] = txPin;
      can[F("listenOnly")] = listenOnlyMode;
      can[F("rxQueueLen")] = rxQueueLen;
      can[F("filterEnabled")] = filterEnabled;
      can[F("filterExt")] = filterExt;
      can[F("filterId")] = filterId;
      can[F("filterMask")] = filterMask;
      can[F("rxCount")] = framesReceived;
      can[F("txCount")] = framesTransmitted;
      can[F("errors")] = busErrors;
      can[F("overruns")] = overruns;
      can[F("lastFrameMs")] = lastFrameTime;
      can[F("msSinceFrame")] = framesReceived > 0 ? (millis() - lastFrameTime) : 0;
      
      // Add UI effect setting
      can[F("uiEffect")] = uiEffect;
      can[F("uiPollRate")] = uiPollRate;
      
      // Add last few frames (only if enabled and started)
      if (!canLite && enabled && twaiStarted && bufferCount > 0) {
        JsonArray frames = can.createNestedArray(F("recentFrames"));
        
        // Show last 20 frames (or fewer if buffer has less)
        int framesToShow = min(bufferCount, (uint8_t)20);
        int startIdx = (bufferHead - framesToShow + CAN_FRAME_BUFFER_SIZE) % CAN_FRAME_BUFFER_SIZE;
        
        for (int i = 0; i < framesToShow; i++) {
          int idx = (startIdx + i) % CAN_FRAME_BUFFER_SIZE;
          CANFrame& frame = frameBuffer[idx];
          
          JsonObject frameObj = frames.createNestedObject();
          frameObj[F("id")] = frame.id;
          frameObj[F("ext")] = frame.extended;
          frameObj[F("rtr")] = frame.rtr;
          frameObj[F("dlc")] = frame.dlc;
          
          JsonArray dataArr = frameObj.createNestedArray(F("data"));
          for (int j = 0; j < frame.dlc && j < 8; j++) {
            dataArr.add(frame.data[j]);
          }
          
          frameObj[F("time")] = frame.timestamp_ms;
        }
      }
    }

    void addToJsonStateLite(JsonObject& root) {
      JsonObject can = root.createNestedObject(F("can"));
      can[F("enabled")] = enabled;
      can[F("started")] = twaiStarted;
      can[F("bitrate")] = bitrate;
      can[F("rxPin")] = rxPin;
      can[F("txPin")] = txPin;
      can[F("listenOnly")] = listenOnlyMode;
      can[F("rxQueueLen")] = rxQueueLen;
      can[F("filterEnabled")] = filterEnabled;
      can[F("filterExt")] = filterExt;
      can[F("filterId")] = filterId;
      can[F("filterMask")] = filterMask;
      can[F("rxCount")] = framesReceived;
      can[F("txCount")] = framesTransmitted;
      can[F("errors")] = busErrors;
      can[F("overruns")] = overruns;
      can[F("lastFrameMs")] = lastFrameTime;
      can[F("msSinceFrame")] = framesReceived > 0 ? (millis() - lastFrameTime) : 0;
      can[F("uiEffect")] = uiEffect;
      can[F("uiPollRate")] = uiPollRate;
    }
    
    // Read state from JSON
    void readFromJsonState(JsonObject& root) override {
      if (!initDone) return;
      
      JsonObject can = root[F("can")];
      if (!can.isNull()) {
        // Check for UI effect change
        if (can.containsKey(F("uiEffect"))) {
          uint8_t newEffect = can[F("uiEffect")] | 0;
          if (newEffect != uiEffect && newEffect < 3) {
            uiEffect = newEffect;
            // Effect logic would go here in the future
          }
        }
        
        // Check for poll rate change
        if (can.containsKey(F("uiPollRate"))) {
          uint8_t newRate = can[F("uiPollRate")] | 0;
          if (newRate != uiPollRate && newRate < 3) {
            uiPollRate = newRate;
          }
        }
      }
    }
    
    // Save configuration
    void addToConfig(JsonObject& root) override {
      JsonObject top = root.createNestedObject(FPSTR(_name));
      top[FPSTR(_enabled)] = enabled;
      top[FPSTR(_bitrate)] = bitrate;
      top[FPSTR(_rxPin)] = rxPin;
      top[FPSTR(_txPin)] = txPin;
      top[FPSTR(_listenOnly)] = listenOnlyMode;
      top[FPSTR(_uiPollRate)] = uiPollRate;
      top[FPSTR(_uiEffect)] = uiEffect;
      top[FPSTR(_rxQueueLen)] = rxQueueLen;
      top[FPSTR(_filterEnabled)] = filterEnabled;
      top[FPSTR(_filterExt)] = filterExt;
      top[FPSTR(_filterId)] = filterId;
      top[FPSTR(_filterMask)] = filterMask;
    }
    
    // Load configuration
    bool readFromConfig(JsonObject& root) override {
      JsonObject top = root[FPSTR(_name)];
      
      bool configComplete = !top.isNull();
      
      bool prevEnabled = enabled;
      int8_t prevRxPin = rxPin;
      int8_t prevTxPin = txPin;
      uint32_t prevBitrate = bitrate;
      bool prevListenOnly = listenOnlyMode;
      uint16_t prevRxQueueLen = rxQueueLen;
      bool prevFilterEnabled = filterEnabled;
      bool prevFilterExt = filterExt;
      uint32_t prevFilterId = filterId;
      uint32_t prevFilterMask = filterMask;
      
      configComplete &= getJsonValue(top[FPSTR(_enabled)], enabled, false);
      configComplete &= getJsonValue(top[FPSTR(_bitrate)], bitrate, 500000);
      configComplete &= getJsonValue(top[FPSTR(_rxPin)], rxPin, (int8_t)4);
      configComplete &= getJsonValue(top[FPSTR(_txPin)], txPin, (int8_t)5);
      configComplete &= getJsonValue(top[FPSTR(_listenOnly)], listenOnlyMode, true);
      configComplete &= getJsonValue(top[FPSTR(_uiPollRate)], uiPollRate, (uint8_t)2);
      configComplete &= getJsonValue(top[FPSTR(_uiEffect)], uiEffect, (uint8_t)0);
      configComplete &= getJsonValue(top[FPSTR(_rxQueueLen)], rxQueueLen, (uint16_t)128);
      configComplete &= getJsonValue(top[FPSTR(_filterEnabled)], filterEnabled, false);
      configComplete &= getJsonValue(top[FPSTR(_filterExt)], filterExt, false);
      configComplete &= getJsonValue(top[FPSTR(_filterId)], filterId, (uint32_t)0);
      configComplete &= getJsonValue(top[FPSTR(_filterMask)], filterMask, (uint32_t)0x7FF);

      if (filterExt) {
        filterId &= 0x1FFFFFFF;
        filterMask &= 0x1FFFFFFF;
      } else {
        filterId &= 0x7FF;
        filterMask &= 0x7FF;
      }

      if (filterMask == 0) {
        filterMask = filterExt ? 0x1FFFFFFF : 0x7FF;
      }
      
      // If config changed and we're already initialized, restart TWAI
      if (initDone) {
        bool needsRestart = (prevRxPin != rxPin) || (prevTxPin != txPin) || 
               (prevBitrate != bitrate) || (prevListenOnly != listenOnlyMode) ||
               (prevRxQueueLen != rxQueueLen) || (prevFilterEnabled != filterEnabled) ||
               (prevFilterExt != filterExt) || (prevFilterId != filterId) ||
               (prevFilterMask != filterMask);
        
        if (needsRestart && twaiStarted) {
          stopTWAI();
        }
        
        if (enabled && (!twaiStarted || needsRestart)) {
          initTWAI();
        } else if (!enabled && twaiStarted) {
          stopTWAI();
        }
      }
      
      return configComplete;
    }
    
    // Add metadata for settings UI
    void appendConfigData() override {
      oappend(F("addInfo('")); oappend(String(FPSTR(_name)).c_str()); 
      oappend(F(":bitrate")); oappend(F("',1,'<i>Common: 125k, 250k, 500k, 1000k</i>');"));
      
      oappend(F("addInfo('")); oappend(String(FPSTR(_name)).c_str());
      oappend(F(":rxPin")); oappend(F("',1,'<i>RX pin connects to CRX on transceiver</i>');"));
      
      oappend(F("addInfo('")); oappend(String(FPSTR(_name)).c_str());
      oappend(F(":txPin")); oappend(F("',1,'<i>TX pin connects to CTX on transceiver</i>');"));
      
      oappend(F("addInfo('")); oappend(String(FPSTR(_name)).c_str());
      oappend(F(":listenOnly")); oappend(F("',1,'<i>Listen-only = receive only (safer)</i>');"));

      oappend(F("addInfo('")); oappend(String(FPSTR(_name)).c_str());
      oappend(F(":rxQueueLen")); oappend(F("',1,'<i>RX queue length (8-256). Higher reduces overruns</i>');"));

      oappend(F("addInfo('")); oappend(String(FPSTR(_name)).c_str());
      oappend(F(":filterEnabled")); oappend(F("',1,'<i>Enable ID filter to reduce bus load</i>');"));

      oappend(F("addInfo('")); oappend(String(FPSTR(_name)).c_str());
      oappend(F(":filterId")); oappend(F("',1,'<i>Filter ID (decimal). Use with mask</i>');"));

      oappend(F("addInfo('")); oappend(String(FPSTR(_name)).c_str());
      oappend(F(":filterMask")); oappend(F("',1,'<i>Filter mask (decimal). 0x7FF for full STD mask</i>');"));

      oappend(F("addInfo('")); oappend(String(FPSTR(_name)).c_str());
      oappend(F(":filterExt")); oappend(F("',1,'<i>Filter for extended (29-bit) IDs</i>');"));
    }
    
    // Get usermod ID
    uint16_t getId() override {
      return USERMOD_ID_CAN_TWAI;
    }
    
    // Destructor - cleanup
    ~UsermodCANTWAI() {
      stopTWAI();
    }
};

// Static member definitions
const char UsermodCANTWAI::_name[]       PROGMEM = "CAN_TWAI";
const char UsermodCANTWAI::_enabled[]    PROGMEM = "enabled";
const char UsermodCANTWAI::_bitrate[]    PROGMEM = "bitrate";
const char UsermodCANTWAI::_rxPin[]      PROGMEM = "rxPin";
const char UsermodCANTWAI::_txPin[]      PROGMEM = "txPin";
const char UsermodCANTWAI::_listenOnly[] PROGMEM = "listenOnly";
const char UsermodCANTWAI::_uiPollRate[] PROGMEM = "uiPollRate";
const char UsermodCANTWAI::_uiEffect[]   PROGMEM = "uiEffect";
const char UsermodCANTWAI::_rxQueueLen[] PROGMEM = "rxQueueLen";
const char UsermodCANTWAI::_filterEnabled[] PROGMEM = "filterEnabled";
const char UsermodCANTWAI::_filterExt[] PROGMEM = "filterExt";
const char UsermodCANTWAI::_filterId[] PROGMEM = "filterId";
const char UsermodCANTWAI::_filterMask[] PROGMEM = "filterMask";

// Create instance and register
static UsermodCANTWAI usermodCANTWAI;
REGISTER_USERMOD(usermodCANTWAI);

#endif // ESP32 && !CONFIG_IDF_TARGET_ESP32C2
