---
name: model-trainer
description: This skill enables training and fine-tuning of language models
  using TRL (Transformer Reinforcement Learning). It supports various training
  methods including supervised fine-tuning, reinforcement learning from human
  feedback (RLHF), and parameter-efficient fine-tuning (PEFT). The skill
  integrates with Hugging Face Jobs infrastructure for scalable training.
allowed-tools: run_command write_file read_file search_code
metadata:
  legacy_slug: model_trainer
  legacy_summary: Train and fine-tune language models using TRL (Transformer
    Reinforcement Learning) on Hugging Face infrastructure
  legacy_version: 0.1.0
  legacy_tags: '["machine learning","training","fine-tuning","TRL","Hugging Face","LLM"]'
  legacy_triggers: '["train model","fine-tune","TRL","reinforcement
    learning","RLHF","PEFT","LoRA","QLoRA"]'
  legacy_priority: default
  legacy_assets: "[]"
  legacy_recommended_tools: '["run_command","write_file","read_file","search_code"]'
---

# Model Trainer Skill

## When to use this skill
- Use when the user request matches this skill's domain and capabilities.
- Use when this workflow or toolchain is explicitly requested.

## When not to use this skill
- Do not use when another skill is a better direct match for the task.
- Do not use when the request is outside this skill's scope.

## Overview
This skill helps you train and fine-tune language models using TRL (Transformer Reinforcement Learning) on Hugging Face infrastructure.

## Core Capabilities

### 1. Supervised Fine-Tuning
- Load pre-trained models from Hugging Face Hub
- Prepare datasets for fine-tuning
- Configure training arguments
- Handle model checkpointing and saving

### 2. Reinforcement Learning from Human Feedback (RLHF)
- Set up reward models
- Configure PPO (Proximal Policy Optimization) training
- Manage reward datasets
- Monitor training metrics

### 3. Parameter-Efficient Fine-Tuning (PEFT)
- LoRA (Low-Rank Adaptation) configuration
- QLoRA for quantized training
- Memory-efficient fine-tuning strategies

### 4. Training Infrastructure
- Hugging Face Jobs integration
- Multi-GPU training setup
- Distributed training configuration
- Resource optimization

## Usage Instructions

### Basic Fine-Tuning
1. Choose a base model from Hugging Face Hub
2. Prepare your training dataset
3. Configure training arguments
4. Set up the trainer with appropriate parameters
5. Monitor training progress and metrics

### RLHF Training
1. Set up a reward model
2. Prepare preference datasets
3. Configure PPO training parameters
4. Run training with appropriate safety constraints
5. Evaluate model performance

### PEFT Training
1. Choose PEFT method (LoRA/QLoRA)
2. Configure adapter parameters
3. Set up memory-efficient training
4. Save and load adapter weights

## Dependencies
- transformers
- trl
- datasets
- accelerate
- peft
- bitsandbytes (for quantization)
- wandb (for experiment tracking)

## Best Practices
- Start with small learning rates for fine-tuning
- Use appropriate batch sizes based on available memory
- Implement gradient clipping for stable training
- Save checkpoints regularly
- Monitor training metrics closely
- Use appropriate evaluation metrics for your use case

## Integration Notes
- Works seamlessly with Hugging Face Hub for model storage
- Supports integration with Weights & Biases for experiment tracking
- Compatible with various model architectures (BERT, GPT, T5, etc.)
- Can be used with custom datasets and evaluation metrics
