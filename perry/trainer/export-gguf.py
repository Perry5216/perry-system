"""
P.E.R.R.Y. GGUF Exporter — export-gguf.py
==========================================
Takes already-merged safetensors from a previous successful LoRA merge
and compresses them into a Q5_K_M GGUF file using llama.cpp.

This is used as a recovery path when the LoRA training + merge succeeded
but the final GGUF compression step failed (e.g. missing system deps).

Usage:
    python export-gguf.py --model-dir /workspace/training/project-project-77/gguf
"""

import argparse
import subprocess
import sys
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", required=True, help="Directory containing merged safetensors")
    parser.add_argument("--quant", default="q5_k_m", help="Quantization method")
    args = parser.parse_args()

    model_dir = Path(args.model_dir)
    
    # Verify safetensors exist
    safetensors = list(model_dir.glob("*.safetensors"))
    if not safetensors:
        print("ERROR: No safetensors files found in", model_dir)
        sys.exit(1)
    
    print(f"\n{'='*60}")
    print(f" P.E.R.R.Y. GGUF Exporter (Recovery Mode)")
    print(f" Model dir: {model_dir}")
    print(f" Safetensors found: {len(safetensors)}")
    print(f" Quantization: {args.quant}")
    print(f"{'='*60}\n")
    
    # Step 1: Locate llama.cpp (pre-built by the trainer Dockerfile at /opt/llama.cpp)
    llama_cpp_dir = Path("/opt/llama.cpp")
    if not llama_cpp_dir.exists():
        print(f"ERROR: llama.cpp not found at {llama_cpp_dir} — the trainer image should pre-build it.")
        sys.exit(1)
    
    # Step 2: Find the converter and quantizer
    converter = None
    for candidate in [
        llama_cpp_dir / "convert_hf_to_gguf.py",
        llama_cpp_dir / "convert-hf-to-gguf.py",
    ]:
        if candidate.exists():
            converter = candidate
            break
    
    if not converter:
        print("ERROR: Cannot find convert_hf_to_gguf.py in llama.cpp")
        sys.exit(1)
    
    quantizer = None
    for candidate in [
        llama_cpp_dir / "llama-quantize",
        llama_cpp_dir / "quantize",
        llama_cpp_dir / "llama-quantize",
        llama_cpp_dir / "llama-quantize", llama_cpp_dir / "build" / "bin" / "llama-quantize",
        llama_cpp_dir / "build" / "bin" / "quantize",
    ]:
        if candidate.exists():
            quantizer = candidate
            break
    
    if not quantizer:
        print("ERROR: Cannot find llama-quantize binary")
        sys.exit(1)
    
    # Step 3: Convert HF safetensors to bf16 GGUF
    bf16_gguf = model_dir / "model-bf16.gguf"
    print(f"\nStep 1/2: Converting safetensors to bf16 GGUF...")
    subprocess.run([
        sys.executable, str(converter),
        str(model_dir),
        "--outfile", str(bf16_gguf),
        "--outtype", "bf16",
    ], check=True)
    
    if not bf16_gguf.exists():
        print("ERROR: bf16 GGUF was not created")
        sys.exit(1)
    
    print(f"bf16 GGUF created: {bf16_gguf.stat().st_size / 1e9:.1f} GB")
    
    # Step 4: Quantize to target format
    final_gguf = model_dir / f"model-{args.quant.upper()}.gguf"
    print(f"\nStep 2/2: Quantizing to {args.quant}...")
    subprocess.run([
        str(quantizer),
        str(bf16_gguf),
        str(final_gguf),
        args.quant,
    ], check=True)
    
    if not final_gguf.exists():
        print("ERROR: Quantized GGUF was not created")
        sys.exit(1)
    
    print(f"Quantized GGUF created: {final_gguf.stat().st_size / 1e9:.1f} GB")
    
    # Step 5: Clean up the massive bf16 intermediate file
    print(f"\nCleaning up bf16 intermediate ({bf16_gguf.stat().st_size / 1e9:.1f} GB)...")
    bf16_gguf.unlink()
    
    print(f"\n{'='*60}")
    print(f" GGUF Export Complete!")
    print(f" Output: {final_gguf}")
    print(f" Size: {final_gguf.stat().st_size / 1e9:.1f} GB")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()


