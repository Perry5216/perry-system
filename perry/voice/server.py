"""
perry-voice — FastAPI sidecar for TTS + STT.

Routes:
  GET  /healthz                          → liveness
  GET  /tts?text=...&voice=...           → audio/mpeg bytes (Edge TTS)
  POST /stt   multipart-file=audio       → { text, language, duration }
  GET  /voices                           → list available TTS voices

The perry container's dashboard-api proxies /api/voice/* requests here over
the internal docker network. perry-voice never exposes a host port — only
reachable as `perry-voice:5005` from other containers in the perry-system
compose project.

Whisper model is loaded lazily on first STT call to keep boot fast.
"""
from __future__ import annotations

import asyncio
import io
import os
import tempfile
from typing import Optional

import edge_tts  # type: ignore
from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse, JSONResponse
from faster_whisper import WhisperModel  # type: ignore

app = FastAPI(title="perry-voice", version="0.1.0")

WHISPER_MODEL = os.environ.get("WHISPER_MODEL", "tiny")
WHISPER_DEVICE = os.environ.get("WHISPER_DEVICE", "cpu")
WHISPER_COMPUTE_TYPE = os.environ.get("WHISPER_COMPUTE_TYPE", "int8")

_whisper_model: Optional[WhisperModel] = None
_whisper_lock = asyncio.Lock()


async def get_whisper() -> WhisperModel:
    """Lazy-load the Whisper model on first STT call. Cached afterwards."""
    global _whisper_model
    async with _whisper_lock:
        if _whisper_model is None:
            _whisper_model = WhisperModel(
                WHISPER_MODEL,
                device=WHISPER_DEVICE,
                compute_type=WHISPER_COMPUTE_TYPE,
            )
    return _whisper_model


@app.get("/healthz")
async def health() -> dict:
    return {
        "ok": True,
        "tts": {"provider": "edge-tts", "default_voice": "en-US-AvaNeural"},
        "stt": {
            "provider": "faster-whisper",
            "model": WHISPER_MODEL,
            "device": WHISPER_DEVICE,
            "compute_type": WHISPER_COMPUTE_TYPE,
            "loaded": _whisper_model is not None,
        },
    }


@app.get("/voices")
async def list_voices(language: str = Query("en", min_length=2, max_length=5)) -> JSONResponse:
    voices = await edge_tts.list_voices()
    filtered = [
        {
            "name": v["Name"],
            "shortName": v["ShortName"],
            "gender": v["Gender"],
            "locale": v["Locale"],
        }
        for v in voices
        if v["Locale"].lower().startswith(language.lower())
    ]
    return JSONResponse({"language": language, "count": len(filtered), "voices": filtered})


@app.get("/tts")
async def tts(
    text: str = Query(..., min_length=1, max_length=5000),
    voice: str = Query("en-US-AvaNeural"),
    rate: str = Query("+0%", description="-50% to +50%"),
    pitch: str = Query("+0Hz", description="-50Hz to +50Hz"),
) -> StreamingResponse:
    """
    Synthesize `text` to MP3 using Edge TTS. Streams the audio back to the
    caller so the client can start playing while we generate.
    """
    try:
        communicate = edge_tts.Communicate(text, voice, rate=rate, pitch=pitch)
        buf = io.BytesIO()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                buf.write(chunk["data"])
        buf.seek(0)
        return StreamingResponse(
            buf,
            media_type="audio/mpeg",
            headers={"Content-Disposition": 'inline; filename="speech.mp3"'},
        )
    except Exception as err:
        raise HTTPException(status_code=500, detail=f"edge-tts failed: {err}")


@app.post("/stt")
async def stt(
    audio: UploadFile = File(...),
    language: Optional[str] = Query(None, description="ISO-639-1 (e.g. 'en'); omitted = auto-detect"),
) -> JSONResponse:
    """
    Transcribe an uploaded audio file (any format ffmpeg understands) using
    faster-whisper. Returns the full transcript + detected language +
    duration.
    """
    try:
        suffix = os.path.splitext(audio.filename or "audio.wav")[1] or ".wav"
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            content = await audio.read()
            tmp.write(content)
            tmp_path = tmp.name

        model = await get_whisper()
        segments, info = model.transcribe(
            tmp_path,
            language=language,
            beam_size=5,
        )
        text_parts: list[str] = []
        for seg in segments:
            text_parts.append(seg.text)
        os.unlink(tmp_path)

        return JSONResponse({
            "text": "".join(text_parts).strip(),
            "language": info.language,
            "language_probability": info.language_probability,
            "duration": info.duration,
        })
    except Exception as err:
        raise HTTPException(status_code=500, detail=f"faster-whisper failed: {err}")
