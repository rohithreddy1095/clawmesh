# Bhoomi Network and Device Survey v0

Purpose: prepare Jetson + mesh node deployment safely and pragmatically.

## 1. Jetson Nano Placement

- [ ] Candidate location selected
- [ ] Weather protection possible (enclosure)
- [ ] Stable mounting available
- [ ] Nearby power available
- [ ] Physical security acceptable
- [ ] Heat management considered

## 2. Connectivity Coverage

- [ ] Wi-Fi works at pump area
- [ ] Wi-Fi works at main tank area
- [ ] Wi-Fi works in core food-forest zones
- [ ] Wi-Fi dead zones listed
- [ ] Cellular signal quality checked at key zones
- [ ] Fallback hotspot option available

Record per spot:

- location/zone
- signal source (Wi-Fi/cellular)
- rough quality (good/usable/poor/none)
- notes (time of day, obstacles, weather)

## 3. Control Node Candidates

- [ ] Water control node location(s) identified
- [ ] Weather node location identified
- [ ] Camera node vantage points identified
- [ ] Cable routing practicality checked
- [ ] Enclosure/environment risks noted (rain/dust/insects/rodents)

## 4. First Wave "Claws" (Recommended Discovery List)

Start by inventorying what is easiest to add safely:

- [ ] Tank level sensing
- [ ] Pump power sensing
- [ ] Pump on/off relay control (only after safety review)
- [ ] Main line flow sensing
- [ ] One valve branch sensing/control pilot
- [ ] Camera for human verification at pump/valve area
- [ ] Weather/air temp-humidity node

## 5. Safety Gating Before Any Live Control

- [ ] Manual override is documented and tested
- [ ] Fail-safe behavior on reboot/power loss defined
- [ ] Max runtime limit defined for pilot pump control
- [ ] Verification signals chosen (power + flow + valve state / human)
- [ ] On-site supervision plan for first live tests
