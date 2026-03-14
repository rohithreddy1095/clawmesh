# Hardware Inventory — ClawMesh Sensor Kit v0

status: delivered
ordered: 2026-03-04
delivered_by: 2026-03-10
shipped_to: Gurugram, Haryana
purpose: First real soil moisture sensing connected to Jetson Orin Nano

## Items

### 1. Capacitive Soil Moisture Sensor V2.0 (5-Pack)
- order: "402-6495878-5026751"
- price: ₹337
- delivered: 2026-03-07
- specs:
    output: analog (0–3V proportional to moisture)
    supply: 3.3V–5V
    interface: analog voltage
    quantity: 5 probes
- purpose: >
    Soil moisture measurement across farm zones. Capacitive type
    (no corrosion vs resistive). 5 probes = 5 zones monitored.
- notes: >
    Capacitive sensors output analog voltage. Jetson GPIO doesn't have
    a built-in ADC, so the ADS1115 is needed to read them via I2C.

### 2. ADS1115 16-Bit I2C 4-Channel ADC Module (Robocraze)
- order: "402-6308443-1215541"
- price: ₹329
- delivered: 2026-03-10
- specs:
    resolution: 16-bit
    channels: 4 (single-ended) or 2 (differential)
    interface: I2C (addr 0x48 default, configurable 0x48–0x4B)
    supply: 2V–5.5V
    sample_rate: 8–860 SPS
    programmable_gain: ±0.256V to ±6.144V
- purpose: >
    Converts analog soil moisture sensor output to digital I2C readings.
    4 channels = 4 sensors on one module. With address selection, up to
    4 modules (16 sensors) on one I2C bus.
- wiring:
    VDD: 3.3V (from Jetson)
    GND: common ground
    SCL: Jetson I2C SCL (pin 5)
    SDA: Jetson I2C SDA (pin 3)
    A0-A3: analog inputs from moisture sensors

### 3. 4-Channel I2C Logic Level Bi-Directional Converter
- order: "402-6308443-1215541"
- price: ₹299
- delivered: 2026-03-10  
- specs:
    channels: 4 bidirectional
    low_side: 1.2V–3.6V (Jetson 3.3V)
    high_side: 1.8V–5.5V (sensor 5V)
    interface: I2C / SPI / UART compatible
- purpose: >
    Jetson GPIO is 3.3V. Soil moisture sensors may need 5V for accurate
    readings. This converter safely bridges the voltage levels on
    I2C SDA/SCL lines and analog signal lines.
- notes: >
    May not be strictly needed if ADS1115 runs at 3.3V and sensors
    give usable range at 3.3V. Useful for future 5V sensors/actuators.

### 4. Breadboard 830 Points + Jumper Wire Set (Nescro)
- order: "402-5361486-9207507"
- price: ₹299
- delivered: 2026-03-09
- specs:
    breadboard: 830 tie points
    jumper_wires: 30 total (10 M-M, 10 F-F, 10 M-F)
- purpose: Prototyping connections before permanent deployment.

## Wiring Plan (Prototype)

```
                    ┌─────────────────────────┐
                    │   Jetson Orin Nano       │
                    │                          │
                    │  Pin 1  (3.3V) ──────┐  │
                    │  Pin 3  (SDA)  ──┐   │  │
                    │  Pin 5  (SCL)  ┐ │   │  │
                    │  Pin 6  (GND)  │ │   │  │
                    └────────────────┼─┼───┼──┘
                                     │ │   │
                              ┌──────┼─┼───┼──────┐
                              │ ADS1115 ADC        │
                              │  SCL ←─┘ │   │    │
                              │  SDA ←───┘   │    │
                              │  VDD ←───────┘    │
                              │  GND ←── Pin 6    │
                              │                    │
                              │  A0 ← Sensor 1    │
                              │  A1 ← Sensor 2    │
                              │  A2 ← Sensor 3    │
                              │  A3 ← Sensor 4    │
                              └────────────────────┘
                                     ↑ ↑ ↑ ↑
                              ┌──────┘ │ │ └──────┐
                              │   ┌────┘ └────┐   │
                           Sensor1  Sensor2  Sensor3  Sensor4
                           (capacitive soil moisture probes)
```

## Software Integration Path

1. **I2C setup on Jetson**: Enable I2C bus, verify ADS1115 at 0x48
   ```bash
   sudo i2cdetect -y -r 1    # should show 0x48
   ```

2. **ADS1115 driver**: Use `ads1x15` npm package or raw I2C reads
   - Read channels A0–A3 at configurable sample rate
   - Convert raw ADC value → voltage → moisture percentage

3. **ClawMesh sensor integration**: Replace mock-sensor.ts with real
   ADS1115 reader that pushes soil_moisture frames to WorldModel:
   ```typescript
   // src/mesh/ads1115-sensor.ts
   // Reads I2C bus → ADS1115 → 4x soil moisture → context frames
   ```

4. **Calibration**: Each sensor needs dry/wet calibration:
   - Dry air reading = 0% moisture
   - Submerged in water = 100% moisture
   - Field calibration with known-moisture soil samples

5. **Farm deployment**: After prototype validation on breadboard:
   - Waterproof sensor leads with heat-shrink tubing
   - Run cable from sensors to Jetson enclosure
   - Mount sensors at 15cm depth (root zone) in target zones

## What's Still Needed (Future Orders)

- [ ] ESP32 DevKit — for wireless sensor nodes (WiFi mesh to Jetson)
- [ ] Relay module (4-channel) — for pump/valve actuation
- [ ] Solenoid valves (12V/24V) — for automated irrigation
- [ ] Water flow sensor — for irrigation volume measurement
- [ ] DS18B20 temperature probe — for soil temperature
- [ ] BME280 module — for weather station (temp/humidity/pressure)
- [ ] Waterproof enclosure — for outdoor Jetson + electronics
- [ ] Solar panel + charge controller — for off-grid field power
- [ ] Long jumper wires / cable — for sensor-to-Jetson runs (10–50m)
