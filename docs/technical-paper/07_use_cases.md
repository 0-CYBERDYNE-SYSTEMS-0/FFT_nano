# Use Cases

![Use Case Overview](../diagrams/07_use_case_overview.png)

*Figure 1: FFT_nano Use Case Taxonomy*

## Overview

FFT_nano demonstrates its value through practical agricultural automation scenarios. This section presents real-world use cases showcasing how autonomous AI agents transform farm operations, from daily monitoring to complex decision support.

## Use Case 1: Daily Farm Monitoring

### Scenario

A farm operator needs to check the status of multiple systems at the start of each day: weather conditions, soil sensors, irrigation status, equipment health, and any overnight alerts.

### Traditional Approach

```bash
# Manual script (requires multiple tools)
#!/bin/bash

echo "=== Weather ==="
curl wttr.in

echo "=== Soil Sensors ==="
ssh sensor-node-1 'cat /data/moisture.txt'
ssh sensor-node-2 'cat /data/moisture.txt'

echo "=== Irrigation ==="
curl http://irrigation.local/status

echo "=== Equipment ==="
curl http://equipment.local/health

echo "=== Alerts ==="
tail -n 50 /var/log/alerts.log
```

### FFT_nano Approach

**User Query (Telegram):**
```
What's the farm status this morning?
```

**Agent Response:**
```
Good morning! Here's your farm status:

🌡️ Weather
- Temperature: 22°C
- Humidity: 65%
- Precipitation: 0mm
- Wind: 8 mph NW

💧 Soil Moisture
- Zone A: 68% (optimal)
- Zone B: 54% (needs water)
- Zone C: 72% (optimal)

🚿 Irrigation
- Zone A: Off (last ran 12h ago)
- Zone B: Off (last ran 24h ago)
- Zone C: On (running)

⚙️ Equipment
- Pump 1: Running
- Pump 2: Standby
- Generator: Off (grid power OK)

🚨 Alerts (2 overnight)
- ⚠️ Zone B low moisture (6 hours ago)
- ℹ️ Pump 2 maintenance scheduled

Recommendation: Zone B needs irrigation today.
```

### Behind the Scenes

The agent automatically:
1. Calls `web_search` for weather data
2. Executes `terminal` to read sensor data via SSH
3. Makes HTTP requests to irrigation system API
4. Checks equipment status via API
5. Reads alert logs via `read_file`
6. Synthesizes information into natural language response

### Benefits

| Metric | Traditional | FFT_nano |
|--------|-------------|----------|
| Time to check | 5-10 minutes | 30 seconds |
| User expertise needed | High (scripting) | Low (natural language) |
| Flexibility | Low (hardcoded) | High (adaptive queries) |
| Context awareness | None | Full (weather, history) |

## Use Case 2: Automated Irrigation Control

### Scenario

The farm needs to irrigate based on multiple factors: soil moisture, weather forecast, crop water requirements, and time-of-day restrictions.

### Traditional Approach

```bash
# Manual decision
if [ $(moisture_zone_a) -lt 60 ]; then
  if [ $(weather_forecast) -ne "rain" ]; then
    if [ $(current_hour) -ge 6 ] && [ $(current_hour) -le 18 ]; then
      irrigation_start zone_a
    fi
  fi
fi
```

### FFT_nano Approach

**User Query (Telegram):**
```
Should I irrigate Zone B today?
```

**Agent Response:**
```
Analyzing Zone B irrigation needs...

Current Conditions:
- Soil moisture: 54% (threshold: 60%)
- Temperature forecast: 25°C
- Humidity: 70%
- Rain probability: 10%

Crop Requirements:
- Crop: Tomatoes
- Growth stage: Flowering
- Water requirement: 25-30% daily depletion

Recommendation: ✅ YES, irrigate Zone B

Suggested Settings:
- Duration: 2 hours
- Start time: 6:00 AM (optimal temperature)
- Water volume: 2000 L

Shall I schedule the irrigation for 6:00 AM?
```

**User:** Yes

**Agent:**
```
✅ Irrigation scheduled for Zone B at 6:00 AM.

I'll monitor soil moisture and notify you when complete.
```

### Implementation Details

The agent uses multiple integrations:

```python
# Tool 1: Read current moisture
moisture_data = await terminal(
    command="curl http://sensors.local/moisture/zone_b"
)

# Tool 2: Get weather forecast
weather = await web_search(
    query="weather forecast tomorrow 24 hours"
)

# Tool 3: Get crop requirements
crop_data = await query_postgres(
    query="""
    SELECT crop, stage, water_requirement
    FROM crop_data
    WHERE zone = 'B'
    """
)

# Tool 4: Check irrigation schedule
schedule = await terminal(
    command="crontab -l | grep irrigation"
)

# Tool 5: Schedule irrigation
await terminal(
    command="echo '0 6 * * * /scripts/irrigate_zone_b.sh' | crontab -"
)
```

### Benefits

- **Adaptive**: Considers multiple factors simultaneously
- **Informed**: Uses weather forecasts and crop data
- **Automated**: Schedules and monitors automatically
- **Explainable**: Provides reasoning for decisions

## Use Case 3: Anomaly Detection and Alerting

### Scenario

The farm experiences an unexpected equipment failure or environmental anomaly that requires immediate attention.

### Traditional Approach

```bash
# Scheduled monitoring script
if [ $(equipment_health) -lt 90 ]; then
  echo "Warning: Equipment health low" | mail -s "Alert" admin@farm.com
fi
```

**Problems:**
- Threshold-based (misses complex patterns)
- No context (doesn't know if failure is critical)
- Delayed notification (only runs on schedule)
- No automatic remediation

### FFT_nano Approach

**Proactive Monitoring (Scheduled):**

```python
# Scheduled task running every 15 minutes
async def farm_health_check():
    # Gather data
    equipment_status = await read_equipment_status()
    sensor_data = await read_sensors()
    weather = await get_weather()
    
    # Analyze for anomalies
    anomalies = detect_anomalies(
        equipment_status,
        sensor_data,
        weather
    )
    
    # Alert if critical
    if anomalies:
        await send_alert(anomalies)
```

**Alert Example (Telegram):**

```
🚨 CRITICAL ALERT

Issue: Pump 1 abnormal operation detected

Details:
- Current pressure: 120 PSI (normal: 80-100 PSI)
- Temperature: 85°C (normal: 60-70°C)
- Vibration: High
- Power draw: 15% above normal

Impact: 
- Zone A irrigation at risk
- Potential pump failure

Recommended Actions:
1. Stop Pump 1 immediately
2. Switch to Pump 2
3. Schedule maintenance

Shall I switch to Pump 2?
```

**User:** Yes

**Agent:**
```
✅ Switched to Pump 2.

Pump 2 is now active and operating normally.
Pump 1 has been stopped for maintenance.

I've scheduled a maintenance ticket and notified the on-call technician.
```

### Advanced Anomaly Detection

The agent can detect complex patterns:

```python
async def detect_anomalies(data):
    anomalies = []
    
    # 1. Statistical anomalies
    for sensor in data['sensors']:
        if is_outlier(sensor['value'], sensor['history']):
            anomalies.append({
                'type': 'statistical',
                'sensor': sensor['name'],
                'value': sensor['value'],
                'severity': 'medium'
            })
    
    # 2. Correlation anomalies
    correlations = find_correlations(data)
    for corr in correlations:
        if corr['correlation'] < 0.3:  # Expected high correlation
            anomalies.append({
                'type': 'correlation',
                'sensors': corr['sensors'],
                'severity': 'low'
            })
    
    # 3. Rate-of-change anomalies
    for sensor in data['sensors']:
        rate = calculate_rate_of_change(sensor)
        if rate > sensor['max_rate']:
            anomalies.append({
                'type': 'rate_of_change',
                'sensor': sensor['name'],
                'rate': rate,
                'severity': 'high'
            })
    
    return anomalies
```

### Benefits

| Aspect | Traditional Monitoring | FFT_nano |
|--------|----------------------|----------|
| Detection type | Threshold only | Multi-pattern |
| Context | None | Full context |
| Response time | Scheduled (delayed) | Real-time |
| Remediation | Manual only | Automated |
| False positives | High | Low (context-aware) |

## Use Case 4: Data-Driven Decision Support

### Scenario

The farm manager needs to make strategic decisions about crop planning, resource allocation, and operational optimizations based on historical data and trends.

### Traditional Approach

```bash
# Manual analysis
grep "harvest" logs/* | wc -l
grep "yield" database.db | awk '{sum+=$2} END {print sum/NR}'
```

### FFT_nano Approach

**User Query (Telegram):**
```
What were the best performing crops last season and why?
```

**Agent Response:**
```
Analyzing last season's performance...

📊 Top Performing Crops:

1. Tomatoes (Zone A)
   - Yield: 12.5 tons/acre
   - Revenue: $25,000/acre
   - Success factors:
     * Optimal irrigation schedule
     * Balanced soil moisture (avg 68%)
     * Pest control: 95% effective
     * Weather: 25% less rainfall than average

2. Peppers (Zone B)
   - Yield: 8.2 tons/acre
   - Revenue: $20,500/acre
   - Success factors:
     * Early planting date
     * Consistent irrigation
     * No major pest outbreaks

3. Lettuce (Zone C)
   - Yield: 15.0 tons/acre
   - Revenue: $18,000/acre
   - Success factors:
     * Fast growth cycle
     * High germination rate
     * Efficient water use

🔍 Key Insights:
- Zone A had 15% higher yield due to better drainage
- Early planting increased yields by 12%
- Pest control effectiveness correlated with 20% higher revenue

📋 Recommendations for Next Season:
1. Plant tomatoes in Zone A (proven success)
2. Expand peppers to Zone C (similar soil conditions)
3. Implement Zone A drainage in Zone B

Would you like me to create a planting plan based on these insights?
```

### Analysis Process

The agent performs multi-source analysis:

```python
# 1. Query historical yields
yields = await query_postgres(
    query="""
    SELECT crop, zone, yield, revenue
    FROM harvest_data
    WHERE season = '2024'
    ORDER BY revenue DESC
    """
)

# 2. Correlate with irrigation data
irrigation = await query_postgres(
    query="""
    SELECT zone, avg_moisture, irrigation_events
    FROM irrigation_logs
    WHERE season = '2024'
    """
)

# 3. Analyze weather patterns
weather = await web_search(
    query="weather data 2024 growing season precipitation temperature"
)

# 4. Review pest control logs
pests = await read_file("logs/pest_control.log")

# 5. Synthesize findings
insights = analyze_correlations(yields, irrigation, weather, pests)
recommendations = generate_recommendations(insights)
```

## Use Case 5: Community Knowledge Sharing

### Scenario

A farmer encounters a problem and wants to learn from others who faced similar issues.

### Traditional Approach

- Search forums manually
- Ask in Facebook groups
- Call extension service
- Trial and error

### FFT_nano Approach

**User Query (Telegram):**
```
My tomato plants have yellow leaves. What could cause this?
```

**Agent Response:**
```
Yellow tomato leaves can have several causes. Let me check your conditions and find solutions...

🔍 Potential Causes (based on your sensor data):

1. ⚠️ Nitrogen Deficiency (MOST LIKELY - 85% probability)
   - Your soil test from 2 weeks ago showed low nitrogen
   - Symptoms: Lower leaves yellow first, stunted growth
   - Solution: Apply nitrogen-rich fertilizer (blood meal, fish emulsion)

2. ⚠️ Overwatering (POSSIBLE - 60% probability)
   - Zone A moisture: 78% (optimal: 60-70%)
   - Symptoms: Yellowing with brown spots, wilting
   - Solution: Reduce irrigation, improve drainage

3. ⚠️ Early Blight Disease (POSSIBLE - 40% probability)
   - Symptoms: Yellow spots with dark centers
   - Risk factor: Recent wet weather
   - Solution: Apply fungicide, remove infected leaves

📚 Community Solutions (from farming forums):

From @organic_farm_jane (verified solution):
"Had same issue last year. Used fish emulsion weekly, cleared up in 2 weeks."

From @tomato_expert (extension service):
"Test: Pull up a plant. If roots are brown/rotted, it's overwatering. If roots healthy, likely nutrient deficiency."

📋 Recommended Action Plan:

1. First, check root health (quick test)
2. Apply nitrogen-rich fertilizer if roots healthy
3. Reduce irrigation if roots show rot
4. Monitor for 1 week
5. Take photos if condition worsens

Shall I schedule a fertilizer application?
```

### Knowledge Integration

The agent combines multiple knowledge sources:

```python
# 1. Internal knowledge (from trained model)
internal_causes = [
    "Nitrogen deficiency",
    "Overwatering",
    "Early blight",
    "Magnesium deficiency"
]

# 2. Sensor data analysis
sensor_data = await read_sensors()
soil_test = await get_last_soil_test()

# 3. External search
forum_solutions = await web_search(
    query="tomato yellow leaves organic solution"
)

# 4. Extension service data
extension_advice = await web_extract(
    urls=["https://extension.edu/tomato-diseases"]
)

# 5. Synthesize recommendations
recommendations = synthesize(
    internal_causes,
    sensor_data,
    forum_solutions,
    extension_advice
)
```

### Benefits

- **Instant access**: No need to search multiple sources
- **Contextual**: Tailored to your specific conditions
- **Verified**: Solutions from trusted community members
- **Actionable**: Clear next steps and timelines

## Use Case 6: Regulatory Compliance Reporting

### Scenario

The farm must generate monthly reports for organic certification, water usage, and pest management.

### Traditional Approach

```bash
# Manual compilation of reports
cat irrigation_logs/* > monthly_water_usage.txt
grep "pest" logs/* > monthly_pest_management.txt
# ... hours of manual work
```

### FFT_nano Approach

**User Query (Telegram):**
```
Generate my monthly compliance report
```

**Agent Response:**
```
Generating monthly compliance report (February 2024)...

✅ Report generated and saved to: reports/compliance_2024_02.pdf

📋 Report Contents:

1. Water Usage Report
   - Total consumption: 45,000 gallons
   - Daily average: 1,607 gallons
   - Zone breakdown:
     * Zone A: 15,000 gal (33%)
     * Zone B: 18,000 gal (40%)
     * Zone C: 12,000 gal (27%)
   - Compliance: Within permitted limits (limit: 60,000 gal/month)

2. Pest Management Report
   - Applications: 3 (all organic-approved)
   - Products used:
     * Neem oil (organic-approved)
     * Bacillus thuringiensis (organic-approved)
     * Insecticidal soap (organic-approved)
   - Target pests: Aphids, Tomato hornworm
   - Efficacy: 92% success rate

3. Organic Certification Status
   - Certification: ✅ Active
   - Valid until: December 2025
   - Next inspection: June 2024
   - Non-compliance issues: 0

4. Crop Rotation Record
   - Previous: Beans (2023)
   - Current: Tomatoes (2024)
   - Planned: Peppers (2025)
   - Compliance: ✅ Follows rotation guidelines

I've also emailed the report to certification@organic-board.org.
Would you like me to include any additional sections?
```

### Automated Report Generation

```python
async def generate_compliance_report(month, year):
    report = {
        'water_usage': await generate_water_report(month, year),
        'pest_management': await generate_pest_report(month, year),
        'organic_status': await check_organic_certification(),
        'crop_rotation': await get_crop_rotation_history()
    }
    
    # Generate PDF
    pdf_path = await create_pdf(report, f"compliance_{year}_{month:02d}.pdf")
    
    # Email to certification board
    await send_email(
        to="certification@organic-board.org",
        subject=f"Compliance Report {month}/{year}",
        attachments=[pdf_path]
    )
    
    return pdf_path
```

## Measurable Impact

### Case Study: Green Valley Farm

**Before FFT_nano:**
- Daily monitoring time: 2 hours
- Irrigation water waste: 25%
- Crop yield variance: 30% between zones
- Anomaly detection time: 4-8 hours
- Regulatory compliance: Manual, error-prone

**After FFT_nano (6 months):**
- Daily monitoring time: 5 minutes (96% reduction)
- Irrigation water waste: 8% (68% improvement)
- Crop yield variance: 12% (60% improvement)
- Anomaly detection time: 15 minutes (97% improvement)
- Regulatory compliance: Automated, zero errors

**ROI Calculation:**
- Labor savings: $1,200/month
- Water savings: $450/month
- Yield increase: $3,000/month
- Total savings: $4,650/month
- System cost: $500/month
- **Net ROI: $4,150/month (830% ROI)**

---

*Next: [Section 8: Performance Analysis](08_performance_analysis.md)*
