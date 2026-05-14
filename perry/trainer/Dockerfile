FROM nvidia/cuda:12.8.0-devel-ubuntu22.04

WORKDIR /trainer

# System deps (includes llama.cpp build requirements: libssl, libcurl)
RUN apt-get update && apt-get install -y \
    git curl build-essential cmake ninja-build python3 python3-pip \
    libssl-dev libcurl4-openssl-dev \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3 /usr/bin/python

# Install PyTorch with CUDA 12.4 (Pinned to 2.5.1 for torchao compatibility)
RUN pip install --no-cache-dir \
    torch==2.5.1 torchvision==0.20.1 torchaudio==2.5.1 \
    --index-url https://download.pytorch.org/whl/cu124

# Install Unsloth from PyPI (latest release) + training stack
RUN pip install --no-cache-dir \
    "unsloth>=2026.5" \
    trl transformers accelerate peft bitsandbytes \
    datasets sentencepiece protobuf

# Install llama.cpp python bindings for GGUF export
# CPU-only compilation since GGUF export does not require a GPU
RUN pip install --no-cache-dir llama-cpp-python

# Pre-install llama.cpp from source (for standalone GGUF export fallback)
RUN git clone --depth=1 https://github.com/ggml-org/llama.cpp.git /root/.unsloth/llama.cpp \
    && mkdir -p /root/.unsloth/llama.cpp/build \
    && cd /root/.unsloth/llama.cpp/build \
    && cmake .. -DCMAKE_BUILD_TYPE=Release \
    && cmake --build . --config Release -j$(nproc) \
    && pip install --no-cache-dir -r /root/.unsloth/llama.cpp/requirements.txt 2>/dev/null || true

COPY finetune.py /trainer/finetune.py
COPY export-gguf.py /trainer/export-gguf.py
COPY watch-and-train.sh /trainer/watch-and-train.sh
RUN chmod +x /trainer/watch-and-train.sh

# CUDA_VISIBLE_DEVICES=1 targets 5070 Ti
ENV CUDA_VISIBLE_DEVICES=1
ENV HF_HOME=/trainer/hf_cache

CMD ["/trainer/watch-and-train.sh"]
