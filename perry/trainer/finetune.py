"""
P.E.R.R.Y. LoRA Fine-tuner — finetune.py
=========================================
Trains a LoRA adapter on Qwen3.6-27B using Perry calibration data.
Runs on GPU 0 (5090, 32GB) via CUDA_VISIBLE_DEVICES=0 set in Docker.
Exports the merged model as GGUF for Ollama deployment.

Usage:
    python finetune.py --data /workspace/training/training_data.jsonl \
                       --output /workspace/training/lora-adapter \
                       --gguf-output /workspace/training/gguf
"""

import argparse
import json
import os
from pathlib import Path

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", required=True, help="JSONL training data path")
    parser.add_argument("--output", required=True, help="LoRA adapter output directory")
    parser.add_argument("--gguf-output", required=True, help="GGUF export directory")
    parser.add_argument("--model", default="anthracite-org/magnum-v2-32b", help="Base model")
    parser.add_argument("--max-steps", type=int, default=300, help="Training steps")
    parser.add_argument("--lora-rank", type=int, default=16, help="LoRA rank (higher=more capacity)")
    args = parser.parse_args()

    print(f"\n{'='*60}")
    print(f" P.E.R.R.Y. LoRA Fine-tuner")
    print(f" Base model: {args.model}")
    print(f" Training data: {args.data}")
    print(f" Max steps: {args.max_steps}")
    print(f" LoRA rank: {args.lora_rank}")
    print(f"{'='*60}\n")

    # ── Validate training data ────────────────────────────────────────────────
    with open(args.data, 'r') as f:
        records = [json.loads(line) for line in f if line.strip()]

    print(f"Loaded {len(records)} training records")

    # ── Monkey-patch PyTorch 2.6 for torchao compatibility ────────────────────
    import torch
    import torch.utils._pytree
    if not hasattr(torch.utils._pytree, 'register_constant'):
        torch.utils._pytree.register_constant = lambda x: None
        
    # ── Load model with Unsloth ───────────────────────────────────────────────
    from unsloth import FastLanguageModel

    print(f"\nLoading {args.model} with 4-bit quantization...")
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=args.model,
        max_seq_length=2048,
        dtype=None,  # Auto-detect
        load_in_4bit=True,
    )

    # ── Add LoRA adapters ─────────────────────────────────────────────────────
    model = FastLanguageModel.get_peft_model(
        model,
        r=args.lora_rank,
        target_modules=[
            "q_proj", "k_proj", "v_proj", "o_proj",
            "gate_proj", "up_proj", "down_proj",
        ],
        lora_alpha=args.lora_rank * 2,
        lora_dropout=0,
        bias="none",
        use_gradient_checkpointing="unsloth",
        random_state=42,
        use_rslora=False,
        loftq_config=None,
    )

    print(f"LoRA adapter added (rank={args.lora_rank})")

    # ── Format training data ──────────────────────────────────────────────────
    def format_record(record):
        """Convert our conversation format to Gemma chat template."""
        conversations = record.get("conversations", [])
        text = tokenizer.apply_chat_template(
            conversations,
            tokenize=False,
            add_generation_prompt=False,
        )
        return {"text": text}

    from datasets import Dataset
    formatted = [format_record(r) for r in records]
    dataset = Dataset.from_list(formatted)
    print(f"Dataset prepared: {len(dataset)} examples")

    # ── Train ─────────────────────────────────────────────────────────────────
    from trl import SFTTrainer
    from transformers import TrainingArguments

    Path(args.output).mkdir(parents=True, exist_ok=True)

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=dataset,
        dataset_text_field="text",
        max_seq_length=2048,
        dataset_num_proc=2,
        packing=True,  # Efficient packing for short sequences
        args=TrainingArguments(
            per_device_train_batch_size=1,
            gradient_accumulation_steps=8,
            warmup_steps=10,
            max_steps=args.max_steps,
            learning_rate=2e-4,
            fp16=not torch.cuda.is_bf16_supported(),
            bf16=torch.cuda.is_bf16_supported(),
            logging_steps=10,
            optim="adamw_8bit",
            weight_decay=0.01,
            lr_scheduler_type="linear",
            seed=42,
            output_dir=args.output,
            save_steps=100,
            save_total_limit=2,
            report_to="none",
        ),
    )

    print(f"\nStarting training ({args.max_steps} steps)...")
    trainer_stats = trainer.train()
    print(f"\nTraining complete!")
    print(f"  Loss: {trainer_stats.training_loss:.4f}")

    # ── Export to GGUF ────────────────────────────────────────────────────────
    Path(args.gguf_output).mkdir(parents=True, exist_ok=True)

    print(f"\nExporting merged model to GGUF (Q6_K quantization)...")
    # Merge LoRA into base and export as GGUF
    model.save_pretrained_gguf(
        args.gguf_output,
        tokenizer,
        quantization_method="q5_k_m",  # Best sweet spot for RTX 5090 + massive context
    )

    # ── Save LoRA adapter ─────────────────────────────────────────────────────
    model.save_pretrained(args.output)
    tokenizer.save_pretrained(args.output)
    print(f"LoRA adapter saved to: {args.output}")

    gguf_files = list(Path(args.gguf_output).glob("*.gguf"))
    if gguf_files:
        print(f"GGUF exported: {gguf_files[0]}")
        print(f"Size: {gguf_files[0].stat().st_size / 1e9:.1f} GB")
    else:
        print("WARNING: No GGUF file found after export")

    print(f"\n{'='*60}")
    print(f" Fine-tune complete!")
    print(f" Training loss: {trainer_stats.training_loss:.4f}")
    print(f" Steps: {args.max_steps}")
    print(f" Output: {args.output}")
    print(f" GGUF: {args.gguf_output}")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()
