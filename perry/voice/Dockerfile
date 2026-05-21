# perry-voice — Python sidecar for TTS (edge-tts) + STT (faster-whisper).
#
# Subscription-free ethos:
#   - edge-tts uses Microsoft Edge's free TTS endpoint (no API key)
#   - faster-whisper runs Whisper locally (CPU or CUDA); no API key
#
# First STT call downloads the Whisper model (default: tiny, ~75MB).
# Override with WHISPER_MODEL env var: tiny / base / small / medium / large
#
# CPU-only by default. To enable CUDA, set CUDA_VISIBLE_DEVICES + uncomment
# the deploy.resources block in compose.yaml.

FROM python:3.11-slim

# ffmpeg required by faster-whisper for audio decoding.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .

EXPOSE 5005

# Cache dir for the whisper model. Mount as a volume so models persist
# across container rebuilds (see compose.yaml).
ENV HF_HOME=/cache
ENV WHISPER_MODEL=tiny
ENV WHISPER_DEVICE=cpu
ENV WHISPER_COMPUTE_TYPE=int8

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "5005", "--log-level", "info"]
