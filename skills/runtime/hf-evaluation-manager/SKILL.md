---
name: hf-evaluation-manager
description: Adapted from Hugging Face's evaluation manager skill for
  FF-Terminal, this skill provides comprehensive tools for managing evaluation
  results of machine learning models used in agricultural contexts. It supports
  tracking crop prediction models, yield forecasting systems, disease detection
  models, and other agricultural ML applications. Includes integration with
  model cards, benchmark comparisons, and performance tracking over time.
allowed-tools: analyze_data write_file run_command tavily_search generate_image_gemini
metadata:
  legacy_slug: hf_evaluation_manager
  legacy_summary: Manage and track model evaluation results for agricultural ML
    models and farm prediction systems
  legacy_version: 0.1.0
  legacy_tags: '["huggingface","evaluation","metrics","benchmarking","agriculture","machine-learning","model-performance","farming"]'
  legacy_triggers: '["evaluation","model
    evaluation","metrics","benchmark","performance","model card","agricultural
    model","crop model","disease detection","yield prediction"]'
  legacy_priority: default
  legacy_assets: "[]"
  legacy_recommended_tools: '["analyze_data","write_file","run_command","tavily_search","generate_image_gemini"]'
---

# Hugging Face Evaluation Manager for FF-Terminal

## When not to use this skill
- Do not use when another skill is a better direct match for the task.
- Do not use when the request is outside this skill's scope.

## Overview
This skill enables you to manage, track, and analyze evaluation results for machine learning models used in agricultural applications. It provides tools for adding structured evaluation data to model cards, comparing performance across different models, and maintaining comprehensive evaluation histories.

## When to Use This Skill
Use this skill when you need to:
- Track evaluation results for crop yield prediction models
- Compare performance of different disease detection models
- Monitor model accuracy for weather forecasting systems
- Add evaluation metrics to agricultural ML model cards
- Benchmark models against industry standards
- Track model performance over growing seasons
- Evaluate precision agriculture algorithms

## Key Capabilities

### 1. Agricultural Model Types Supported
- **Crop Yield Prediction**: Regression models for yield forecasting
- **Disease Detection**: Classification models for plant disease identification
- **Weather Prediction**: Time series models for weather and climate forecasting
- **Soil Analysis**: Models for soil property prediction and recommendations
- **Pest Detection**: Computer vision models for pest identification
- **Irrigation Optimization**: Models for water usage optimization
- **Harvest Timing**: Models for optimal harvest prediction

### 2. Evaluation Metrics
- **Regression Metrics**: MAE, MSE, RMSE, R² for continuous predictions
- **Classification Metrics**: Accuracy, Precision, Recall, F1-Score, AUC-ROC
- **Time Series Metrics**: MAPE, SMAPE, Directional Accuracy
- **Custom Agricultural Metrics**: Yield prediction accuracy, disease detection rates
- **Economic Metrics**: Cost-benefit analysis, ROI calculations
- **Environmental Metrics**: Resource efficiency, sustainability scores

### 3. Data Sources for Evaluation
- **Historical Farm Data**: Past seasons' performance data
- **Cross-Validation**: K-fold validation on agricultural datasets
- **Field Trials**: Real-world testing on actual farms
- **Simulation Results**: Controlled environment testing
- **Benchmark Datasets**: Standard agricultural ML benchmarks

## Prerequisites
- Hugging Face account with model repository access
- HF_TOKEN environment variable set
- Python packages: `huggingface_hub`, `pandas`, `numpy`, `scikit-learn`
- Evaluation data in structured format (CSV, JSON)

## Usage Workflow

### Step 1: Prepare Evaluation Results
Format your evaluation data:
```python
import pandas as pd

# Create evaluation results dataframe
eval_results = pd.DataFrame({
    "model_name": ["CropYieldNet_v1", "CropYieldNet_v2"],
    "mae": [0.15, 0.12],
    "rmse": [0.22, 0.18],
    "r2_score": [0.87, 0.91],
    "dataset": "US_Corn_Yields_2020-2023",
    "test_samples": 1000
})
```

### Step 2: Generate Evaluation Report
Create comprehensive evaluation summary:
```python
def generate_eval_report(eval_results, model_name):
    report = f"""
# Model Evaluation Report: {model_name}

## Performance Metrics
- **Mean Absolute Error**: {eval_results['mae']:.3f}
- **Root Mean Square Error**: {eval_results['rmse']:.3f}
- **R² Score**: {eval_results['r2_score']:.3f}

## Dataset Information
- **Test Dataset**: {eval_results['dataset']}
- **Sample Size**: {eval_results['test_samples']:,}
- **Evaluation Date**: {pd.Timestamp.now().strftime('%Y-%m-%d')}

## Agricultural Context
This model was evaluated on historical crop yield data spanning multiple
growing seasons and geographic regions. Performance metrics reflect
real-world prediction accuracy for yield forecasting applications.
"""
    return report
```

### Step 3: Update Model Card
Add evaluation results to model card:
```python
from huggingface_hub import update_repo_metadata

# Prepare model card content
model_card_content = f"""
---
language: en
tags:
- agriculture
- crop-yield
- regression
license: mit
metrics:
- mae
- rmse
- r2
---

# {model_name}

## Model Description
{model_description}

## Evaluation Results
{evaluation_report}

## Usage
```python
from transformers import AutoModelForSequenceClassification
model = AutoModelForSequenceClassification.from_pretrained("your-username/{model_name}")
```
"""

# Update model card
update_repo_metadata(
    repo_id="your-username/your-model",
    token=your_hf_token,
    metadata=model_card_content
)
```

### Step 4: Track Performance Over Time
Maintain evaluation history:
```python
def track_model_performance(model_id, new_results):
    # Load existing evaluation history
    history_file = f"eval_history_{model_id.replace('/', '_')}.json"
    
    try:
        with open(history_file, 'r') as f:
            history = json.load(f)
    except FileNotFoundError:
        history = []
    
    # Add new evaluation results
    new_entry = {
        "timestamp": datetime.now().isoformat(),
        "results": new_results,
        "version": get_current_model_version(model_id)
    }
    history.append(new_entry)
    
    # Save updated history
    with open(history_file, 'w') as f:
        json.dump(history, f, indent=2)
```

## Agricultural Evaluation Best Practices

### Seasonal Validation
- Evaluate models across multiple growing seasons
- Account for seasonal variations and climate patterns
- Test on different geographic regions and soil types
- Consider weather variability and extreme events

### Real-World Testing
- Validate predictions against actual farm outcomes
- Include economic impact assessments
- Test on diverse farming operations and scales
- Consider practical deployment constraints

### Benchmark Comparisons
- Compare against baseline agricultural models
- Include industry-standard benchmarks
- Reference academic literature and established methods
- Provide context for performance metrics

## Integration with FF-Terminal Tools

This skill works seamlessly with other FF-Terminal capabilities:
- **Data Analysis**: Use `analyze_data` tool to explore evaluation results
- **Visualization**: Create performance charts and comparison plots
- **Model Training**: Integrate with training pipelines for continuous evaluation
- **Automation**: Schedule regular model performance monitoring

## Example Use Cases

### 1. Crop Yield Model Evaluation
```python
# Evaluate yield prediction model
yield_model = "CropYieldNet_v2"
test_data = load_yield_test_data("2023_season_data.csv")

# Run evaluation
predictions = yield_model.predict(test_data)
metrics = calculate_regression_metrics(test_data["actual_yield"], predictions)

# Generate and save report
eval_report = generate_eval_report(metrics, yield_model)
update_model_card("your-org/crop-yield-predictor", eval_report)
```

### 2. Disease Detection Model Comparison
```python
# Compare multiple disease detection models
models = ["PlantDiseaseNet_v1", "PlantDiseaseNet_v2", "ResNet50-PlantDisease"]
test_images = load_disease_test_set("plant_disease_test/")

results = []
for model in models:
    predictions = model.predict(test_images)
    metrics = calculate_classification_metrics(test_images["labels"], predictions)
    results.append({"model": model, **metrics})

# Create comparison report
comparison_report = create_comparison_table(results)
update_model_card("your-org/plant-detection-suite", comparison_report)
```

### 3. Model Performance Tracking
```python
# Track model performance over time
model_id = "your-org/weather-forecaster"
new_eval_results = evaluate_weather_model(model_id, "2024_data")

# Add to performance history
track_model_performance(model_id, new_eval_results)

# Generate performance trend analysis
trend_analysis = analyze_performance_trends(model_id)
update_model_card(model_id, trend_analysis)
```

## Advanced Features

### Automated Evaluation Pipelines
- Set up continuous evaluation on new data
- Automated model card updates
- Performance alerting and notifications
- Integration with CI/CD pipelines

### Comparative Analysis
- Multi-model comparison reports
- Statistical significance testing
- Performance ranking and leaderboards
- Cross-dataset generalization analysis

### Economic Impact Assessment
- Cost-benefit analysis for model deployment
- ROI calculations for agricultural applications
- Resource optimization recommendations
- Risk assessment and mitigation strategies

## Troubleshooting

### Common Issues
- **Metric calculation errors**: Verify data formats and column names
- **Model card update failures**: Check repository permissions and token validity
- **Performance inconsistencies**: Ensure consistent evaluation protocols
- **Data quality issues**: Validate test data quality and representativeness

### Error Recovery
- Implement validation checks for evaluation data
- Use backup evaluation methods for edge cases
- Maintain audit trails of evaluation processes
- Provide clear error messages and recovery guidance

## Resources
- [Hugging Face Model Cards Guide](https://huggingface.co/docs/hub/model-cards)
- [Agricultural ML Evaluation Standards](https://example.com/ag-ml-standards)
- [Crop Yield Prediction Benchmarks](https://example.com/yield-benchmarks)
- [Plant Disease Detection Datasets](https://example.com/plant-disease-datasets)
