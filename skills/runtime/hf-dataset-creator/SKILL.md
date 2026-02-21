---
name: hf-dataset-creator
description: Adapted from Hugging Face's dataset creator skill for FF-Terminal,
  this skill provides comprehensive tools for creating, managing, and publishing
  datasets on the Hugging Face Hub. Specialized for agricultural and
  farm-related data including sensor readings, crop yields, weather data, soil
  measurements, and farming operations data. Supports multiple dataset formats
  and provides quality assurance features for data integrity.
allowed-tools: analyze_data write_file run_command tavily_search generate_image_gemini
metadata:
  legacy_slug: hf_dataset_creator
  legacy_summary: Create and manage datasets on Hugging Face Hub with support for
    agricultural data, sensor readings, and farm-related datasets
  legacy_version: 0.1.0
  legacy_tags: '["huggingface","datasets","agriculture","farming","data-management","iot","sensors","research"]'
  legacy_triggers: '["dataset","huggingface","agricultural data","farm
    data","sensor data","crop data","upload data","publish dataset","create
    dataset"]'
  legacy_priority: default
  legacy_assets: "[]"
  legacy_recommended_tools: '["analyze_data","write_file","run_command","tavily_search","generate_image_gemini"]'
---

# Hugging Face Dataset Creator for FF-Terminal

## When not to use this skill
- Do not use when another skill is a better direct match for the task.
- Do not use when the request is outside this skill's scope.

## Overview
This skill enables you to create, manage, and publish datasets on the Hugging Face Hub with a focus on agricultural and farm-related data. It provides tools for dataset initialization, configuration management, and efficient data uploads.

## When to Use This Skill
Use this skill when you need to:
- Create new datasets for agricultural research or farm management
- Upload sensor data, crop yield data, weather measurements, or soil analysis results
- Structure farm operational data for machine learning projects
- Publish datasets for collaboration with the agricultural research community
- Manage existing datasets on the Hugging Face Hub

## Key Capabilities

### 1. Dataset Types Supported
- **Sensor Data**: IoT sensor readings, soil moisture, temperature, humidity
- **Crop Data**: Yield measurements, growth stages, harvest records
- **Weather Data**: Historical weather patterns, forecasts, climate data
- **Soil Analysis**: pH levels, nutrient content, compaction measurements
- **Farm Operations**: Equipment usage, labor records, input applications
- **Economic Data**: Cost analysis, market prices, profitability metrics

### 2. Dataset Formats
- **Tabular/CSV**: Structured data with proper column headers
- **JSON**: Nested data structures for complex farm records
- **Time Series**: Temporal data with timestamps for trend analysis
- **Geospatial**: Location-based data with GPS coordinates
- **Image/Multimedia**: Field photos, drone imagery, sensor visualizations

### 3. Quality Assurance
- Data validation and format checking
- Duplicate detection and removal
- Missing data handling strategies
- Data type consistency verification
- Metadata completeness checks

## Prerequisites
- Hugging Face account with write permissions
- HF_TOKEN environment variable set
- Python packages: `huggingface_hub`, `pandas`, `pyarrow`

## Usage Workflow

### Step 1: Initialize Dataset
```python
from huggingface_hub import HfApi

api = HfApi()
api.create_repo(
    repo_id="your-username/farm-dataset-name",
    repo_type="dataset",
    private=False,
    token=your_hf_token
)
```

### Step 2: Prepare Data
Load and validate your agricultural data:
```python
import pandas as pd

# Load farm data
df = pd.read_csv("farm_sensor_data.csv")

# Validate data structure
required_columns = ["timestamp", "sensor_type", "value", "location"]
assert all(col in df.columns for col in required_columns)

# Clean and preprocess
df = df.dropna()
df["timestamp"] = pd.to_datetime(df["timestamp"])
```

### Step 3: Create Dataset Card
Generate comprehensive metadata:
```python
dataset_card = """
---
language: en
tags:
- agriculture
- farming
- sensor-data
- crop-yield
license: mit
---

# Farm Sensor Dataset

## Dataset Description
This dataset contains sensor readings from agricultural IoT devices...

## Dataset Structure
- `data/`: Main data files in CSV format
- `metadata/`: Sensor configuration and location data
- `README.md`: This file
"""
```

### Step 4: Upload Dataset
Upload files to Hugging Face Hub:
```python
from huggingface_hub import upload_file

upload_file(
    path_or_fileobj="farm_sensor_data.csv",
    path_in_repo="data/farm_sensor_data.csv",
    repo_id="your-username/farm-dataset-name",
    repo_type="dataset",
    token=your_hf_token
)
```

## Best Practices for Agricultural Datasets

### Data Organization
- Use consistent column naming conventions
- Include proper units of measurement
- Add location metadata (GPS coordinates, field names)
- Document data collection methods and equipment used
- Include temporal information (growing season, planting dates)

### Metadata Standards
- Document data sources and collection methods
- Include information about sensor types and calibration
- Specify data frequency and resolution
- Add context about farming practices and crop varieties
- Provide data quality assessments and limitations

### Privacy and Security
- Remove or anonymize sensitive farm location data if needed
- Consider data licensing terms carefully
- Document any data restrictions or usage limitations
- Ensure compliance with agricultural data sharing agreements

## Integration with FF-Terminal Tools

This skill works seamlessly with other FF-Terminal capabilities:
- **Data Analysis**: Use `analyze_data` tool to explore dataset patterns
- **Visualization**: Create charts and graphs for data insights
- **Automation**: Schedule regular data uploads and updates
- **Monitoring**: Set up alerts for data quality issues

## Troubleshooting

### Common Issues
- **Authentication errors**: Verify HF_TOKEN is set correctly
- **Upload failures**: Check file size limits and internet connection
- **Format errors**: Ensure data files match expected schema
- **Permission issues**: Confirm repository access rights

### Error Recovery
- Use `api.repo_info()` to check repository status
- Validate data locally before uploading
- Implement retry logic for network issues
- Keep backup copies of important datasets

## Example Use Cases

### 1. IoT Sensor Data Pipeline
Upload real-time sensor data from farm IoT devices:
```python
# Process incoming sensor data
sensor_data = process_sensor_readings()

# Validate and format
validated_data = validate_agricultural_data(sensor_data)

# Upload to Hub
upload_to_huggingface(validated_data, "farm-iot-sensors")
```

### 2. Crop Yield Analysis
Create datasets for yield prediction models:
```python
# Combine yield data with weather and soil information
yield_dataset = combine_farm_data(
    yield_data="crop_yields.csv",
    weather_data="weather.csv",
    soil_data="soil_analysis.csv"
)

# Create dataset for ML training
create_ml_dataset(yield_dataset, "crop-yield-prediction")
```

### 3. Research Collaboration
Share data with agricultural research community:
```python
# Prepare dataset for publication
research_dataset = prepare_for_publication(raw_farm_data)

# Add comprehensive documentation
add_research_metadata(research_dataset, methodology_info)

# Publish with appropriate license
publish_dataset(research_dataset, license="CC-BY-SA")
```

## Advanced Features

### Version Control
- Track dataset versions with git-like functionality
- Maintain changelog of data updates and modifications
- Support for dataset branching and merging

### Automation
- Schedule regular data uploads and updates
- Automate data quality checks and validation
- Set up notifications for dataset changes

### Integration
- Connect with farm management software APIs
- Import data from agricultural equipment systems
- Export datasets in various formats for different tools

## Resources
- [Hugging Face Datasets Documentation](https://huggingface.co/docs/datasets)
- [Agricultural Data Standards](https://example.com/ag-data-standards)
- [Farm Data Management Best Practices](https://example.com/farm-data-best-practices)
