FROM nvidia/cuda:12.8.0-devel-ubuntu22.04

WORKDIR /trainer

# System deps (includes llama.cpp build requirements: libssl, libcurl)
RUN apt-get update && apt-get install -y \
    git curl build-essential cmake ninja-build python3 python3-pip \
    libssl-dev libcurl4-openssl-dev \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/python3 /usr/bin/python

# Install HuggingFace training stack (NO Unsloth)
RUN pip install --no-cache-dir \
    trl transformers accelerate peft bitsandbytes \
    datasets sentencepiece protobuf gguf

# Install PyTorch Nightly with CUDA 12.8 (Blackwell sm_120 support)
RUN pip install --pre --no-cache-dir --upgrade \
    torch \
    --index-url https://download.pytorch.org/whl/nightly/cu128

# Install llama.cpp python bindings for GGUF export
RUN pip install --no-cache-dir llama-cpp-python

# Pre-install llama.cpp from source (for standalone GGUF export fallback)
RUN git clone --depth=1 https://github.com/ggml-org/llama.cpp.git /opt/llama.cpp \
    && mkdir -p /opt/llama.cpp/build \
    && cd /opt/llama.cpp/build \
    && cmake .. -DCMAKE_BUILD_TYPE=Release \
    && cmake --build . --config Release -j$(nproc)

COPY finetune.py export-gguf.py watch-and-train.sh /trainer/
RUN chmod +x /trainer/watch-and-train.sh

# Drop privileges. Build-time installs above run as root; runtime does not.
# UID 1000 matches the typical host user; Docker Desktop bind mounts on
# Windows/macOS allow read+write from any UID, so volume mounts continue to work.
# On Linux hosts, ensure ./perry/workspace, ./perry/config, ./data/ollama,
# ./data/trainer_cache are writable by UID 1000 (or override with compose `user:`).
RUN groupadd -g 1000 perry \
    && useradd -u 1000 -g 1000 -m -s /bin/bash perry \
    && chown -R perry:perry /trainer

ENV CUDA_VISIBLE_DEVICES=1
ENV HF_HOME=/trainer/hf_cache

USER perry

CMD ["/trainer/watch-and-train.sh"]
