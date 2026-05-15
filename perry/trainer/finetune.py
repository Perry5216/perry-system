#!/usr/bin/env python3
"""
P.E.R.R.Y. LoRA Fine-tuner — Vanilla HuggingFace Edition
=========================================================
Standard HuggingFace Transformers + PEFT + TRL fine-tuning.
Optimized for RTX 5090 Blackwell (32GB VRAM).
"""

import os
import sys
import json
import argparse
import torch
from pathlib import Path

# ── Kill ALL compilation and JIT ─────────────────────────────────────────────
os.environ["TORCH_COMPILE_DISABLE"] = "1"
os.environ["TORCHINDUCTOR_DISABLE"] = "1"
os.environ["TOKENIZERS_PARALLELISM"] = "false"
torch._dynamo.config.suppress_errors = True

# ── Kill accelerate's .float() wrapper (crashes Blackwell sm_120) ────────────
# Accelerate wraps every model.forward() and calls tensor.float() on ALL outputs.
# On Blackwell, that single massive cast on 32B logits kills the CUDA driver.
# Our SafeBlackwellTrainer already handles float32 conversion manually in the
# cross-entropy calculation, so this wrapper is redundant and lethal.
import accelerate.utils.operations as _accel_ops
_accel_ops.convert_to_fp32 = lambda x: x

def main():
    parser = argparse.ArgumentParser(description="P.E.R.R.Y. LoRA Fine-tuner")
    parser.add_argument("--data", required=True, help="Path to training_data.jsonl")
    parser.add_argument("--output", required=True, help="Path for LoRA adapter output")
    parser.add_argument("--gguf-output", default=None, help="Path for GGUF export")
    parser.add_argument("--model", default="anthracite-org/magnum-v2-32b")
    parser.add_argument("--max-steps", type=int, default=-1,
                        help="Max training steps. -1 = use epochs instead")
    parser.add_argument("--epochs", type=int, default=10,
                        help="Number of training epochs (used when max-steps is -1)")
    parser.add_argument("--lora-rank", type=int, default=64)
    args = parser.parse_args()

    # ── Load training data ────────────────────────────────────────────────────
    records = []
    with open(args.data, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    print(f"Loaded {len(records)} training records")

    # ── Calculate steps from data ─────────────────────────────────────────────
    effective_batch_size = 8  # per_device_batch=1 × grad_accum=8
    steps_per_epoch = max(1, len(records) // effective_batch_size)
    if args.max_steps > 0:
        total_steps = args.max_steps
        computed_epochs = total_steps / steps_per_epoch
    else:
        total_steps = steps_per_epoch * args.epochs
        computed_epochs = args.epochs

    print(f"\n{'='*60}")
    print(f" P.E.R.R.Y. LoRA Fine-tuner")
    print(f" Base model: {args.model}")
    print(f" Training data: {args.data}")
    print(f" Examples: {len(records)} | Epochs: {computed_epochs:.1f} | Steps: {total_steps}")
    print(f" Effective batch size: {effective_batch_size}")
    print(f" LoRA rank: {args.lora_rank}")
    print(f" Max sequence length: 2048")
    print(f"{'='*60}\n")

    # ── Load model ────────────────────────────────────────────────────────────
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

    bnb_config = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_compute_dtype=torch.bfloat16,  # bf16 has wider dynamic range than fp16
        bnb_4bit_use_double_quant=True,
    )

    print("Loading tokenizer...")
    tokenizer = AutoTokenizer.from_pretrained(args.model)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token

    print("Loading model in 4-bit (this takes ~2 minutes)...")
    model = AutoModelForCausalLM.from_pretrained(
        args.model,
        quantization_config=bnb_config,
        device_map="auto",
        torch_dtype=torch.bfloat16,
        attn_implementation="sdpa",  # PyTorch native scaled dot-product attention
    )

    # ── Add LoRA adapter ──────────────────────────────────────────────────────
    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training

    model = prepare_model_for_kbit_training(model)

    lora_config = LoraConfig(
        r=args.lora_rank,
        lora_alpha=args.lora_rank * 2,  # alpha=2×rank is standard for rank 64
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                         "gate_proj", "up_proj", "down_proj"],
        lora_dropout=0,
        bias="none",
        task_type="CAUSAL_LM",
    )
    model = get_peft_model(model, lora_config)
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    total = sum(p.numel() for p in model.parameters())
    print(f"LoRA adapter added (rank={args.lora_rank})")
    print(f"Trainable: {trainable:,} / {total:,} ({100*trainable/total:.2f}%)")

    # ── Format training data ──────────────────────────────────────────────────
    def format_record(record):
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
    from trl import SFTTrainer, SFTConfig

    class SafeBlackwellTrainer(SFTTrainer):
        def compute_loss(self, model, inputs, return_outputs=False, **kwargs):
            # HOTFIX: Use F.cross_entropy directly on bf16 logits.
            # The C++ kernel handles precision internally without the Python-level
            # .float() cast that kills the Blackwell sm_120 CUDA driver.
            labels = inputs.pop("labels")
            outputs = model(**inputs)
            logits = outputs.get("logits")
            
            shift_logits = logits[..., :-1, :].contiguous()
            shift_labels = labels[..., 1:].contiguous()
            
            loss = torch.nn.functional.cross_entropy(
                shift_logits.view(-1, shift_logits.size(-1)),
                shift_labels.view(-1),
                ignore_index=-100,
            )
            
            return (loss, outputs) if return_outputs else loss

    Path(args.output).mkdir(parents=True, exist_ok=True)

    sft_config = SFTConfig(
        per_device_train_batch_size=1,
        gradient_accumulation_steps=8,
        warmup_steps=20,
        max_steps=total_steps,
        learning_rate=2e-4,
        fp16=False,
        bf16=True,  # bf16 avoids gradient underflow that fp16 suffers from
        logging_steps=1,
        optim="paged_adamw_8bit",  # Paged 8-bit saves ~2GB VRAM on optimizer states
        weight_decay=0.01,
        lr_scheduler_type="cosine",  # Cosine decay converges deeper than linear
        seed=42,
        output_dir=args.output,
        save_strategy="steps",
        save_steps=50,
        gradient_checkpointing=True,
        gradient_checkpointing_kwargs={"use_reentrant": False},
        max_grad_norm=1.0,  # Less constrained — lets the optimizer take fuller steps
        report_to="none",
        dataloader_pin_memory=False,
        # SFT-specific
        dataset_text_field="text",
        max_length=2048,
        packing=True,
        dataset_num_proc=2,
    )

    trainer = SafeBlackwellTrainer(
        model=model,
        processing_class=tokenizer,
        train_dataset=dataset,
        args=sft_config,
    )

    print(f"\nStarting training ({total_steps} steps)...")
    trainer_stats = trainer.train()

    # ── Save ──────────────────────────────────────────────────────────────────
    print(f"\nTraining complete! Saving LoRA adapter...")
    model.save_pretrained(args.output)
    tokenizer.save_pretrained(args.output)

    final_loss = trainer_stats.training_loss
    print(f"Final loss: {final_loss:.4f}")

    summary_path = Path(args.data).parent / "training_summary.md"
    summary_path.write_text(
        f"# Training Summary\n\n"
        f"- Model: {args.model}\n"
        f"- Steps: {total_steps}\n"
        f"- Epochs: {computed_epochs:.1f}\n"
        f"- Final Loss: {final_loss:.4f}\n"
        f"- LoRA Rank: {args.lora_rank}\n"
        f"- Max Length: 2048\n"
        f"- Adapter: {args.output}\n"
    )
    print(f"Summary saved to {summary_path}")

if __name__ == "__main__":
    main()
