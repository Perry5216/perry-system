#!/bin/bash
# P.E.R.R.Y. Auto-Trainer — watch-and-train.sh
# Polls for READY_TO_FINETUNE.flag every 5 minutes.
# When found, kicks off the LoRA fine-tune on GPU 0 (5090, 32GB).
#
# Recovery: If merged safetensors exist but no .gguf, skips training
# and jumps straight to GGUF export.

WORKSPACE="/workspace"
CHECK_INTERVAL=300  # 5 minutes

echo "=========================================="
echo " P.E.R.R.Y. Auto-Trainer — Watching..."
echo " GPU: CUDA_VISIBLE_DEVICES=${CUDA_VISIBLE_DEVICES}"
echo " Interval: ${CHECK_INTERVAL}s"
echo "=========================================="

# Check GPU
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader

while true; do
    # ─── Phase 0: Check for GGUF-only recovery ────────────────────────────
    # If a previous run merged safetensors but crashed during GGUF export,
    # skip training entirely and just compress.
    RECOVERY_DIR=$(find "${WORKSPACE}/training" -mindepth 1 -maxdepth 1 -type d -name "project-*" | while read dir; do
        GGUF_DIR="${dir}/gguf"
        if [ -d "${GGUF_DIR}" ]; then
            HAS_SAFETENSORS=$(ls "${GGUF_DIR}"/*.safetensors 2>/dev/null | head -1)
            HAS_GGUF=$(ls "${GGUF_DIR}"/*.gguf 2>/dev/null | head -1)
            if [ -n "${HAS_SAFETENSORS}" ] && [ -z "${HAS_GGUF}" ]; then
                echo "${dir}"
                break
            fi
        fi
    done)

    if [ -n "${RECOVERY_DIR}" ]; then
        PROJECT_ID=$(basename "${RECOVERY_DIR}")
        GGUF_DIR="${RECOVERY_DIR}/gguf"
        MODEL_NAME="a.perry:latest"
        OLLAMA_ENDPOINT="http://ollama:11434"

        echo ""
        echo "[$(date)] RECOVERY MODE: Found merged safetensors without GGUF in ${GGUF_DIR}"
        echo "[$(date)] Skipping training — jumping straight to GGUF compression..."

        # Lock the pipeline
        touch "${WORKSPACE}/training/TRAINING_IN_PROGRESS.flag"

        # Flush VRAM
        echo "[$(date)] Flushing VRAM on Writer GPU before GGUF export..."
        curl -s -X POST http://ollama:11434/api/generate -d '{"model": "hf.co/bartowski/magnum-32b-v2-GGUF:Q5_K_M", "keep_alive": 0}' > /dev/null

        # Run the standalone GGUF exporter (bypasses Unsloth's buggy installer)
        python3 /trainer/export-gguf.py --model-dir "${GGUF_DIR}" --quant q5_k_m
        EXPORT_EXIT=$?

        if [ ${EXPORT_EXIT} -eq 0 ]; then
            GGUF_FILE=$(ls "${GGUF_DIR}"/*.gguf 2>/dev/null | head -1)
            if [ -n "${GGUF_FILE}" ]; then
                echo "[$(date)] GGUF compression succeeded: ${GGUF_FILE}"

                # Register with Ollama via shared volume + API
                echo "[$(date)] Copying GGUF to Ollama shared storage..."
                SAFE_MODEL_NAME=$(echo "${MODEL_NAME}" | tr -d ' ' | tr ':' '-')
                cp "${GGUF_FILE}" "/ollama_storage/models/${SAFE_MODEL_NAME}.gguf"

                cat > /tmp/perry-tuned.Modelfile <<MODELEOF
FROM /root/.ollama/models/${SAFE_MODEL_NAME}.gguf

TEMPLATE """{{- if .System }}
<|im_start|>system
{{ .System }}<|im_end|>
{{- end }}
{{- if .Prompt }}
<|im_start|>user
{{ .Prompt }}<|im_end|>
{{- end }}
<|im_start|>assistant
"""

SYSTEM """
You are a Deep POV science fiction author fine-tuned on Perry calibration data.
NEVER use filter words (felt, thought, noticed, realized, saw, looked at, stared, remembered, imagined).
NEVER name emotions — show them through somatic markers only.
NEVER attribute internal states to non-POV characters.
"""

PARAMETER temperature 0.85
PARAMETER top_p 0.95
PARAMETER top_k 40
PARAMETER repeat_penalty 1.15
PARAMETER num_ctx 32768
MODELEOF

                echo "[$(date)] Registering model with Ollama via API..."
                MODELFILE_CONTENT=$(python3 -c "import sys,json; print(json.dumps(open('/tmp/perry-tuned.Modelfile').read()))")
                curl -s -X POST "${OLLAMA_ENDPOINT}/api/create" \
                    -H "Content-Type: application/json" \
                    -d "{\"name\": \"${MODEL_NAME}\", \"modelfile\": ${MODELFILE_CONTENT}}"

                echo ""
                echo "[$(date)] Model ${MODEL_NAME} registered in Ollama!"

                # Update user.json natively (shared volume)
                echo "[$(date)] Auto-switching dashboard config to use new custom author..."
                python3 -c "import json, os; f='/workspace/.config/user.json'; d=json.load(open(f)) if os.path.exists(f) else {'ai':{'ollama':{}}}; d.setdefault('ai',{}).setdefault('ollama',{})['model']='${MODEL_NAME}'; json.dump(d, open(f,'w'), indent=2)"

                # Validate
                echo "[$(date)] Validating new model integrity..."
                VALIDATION_RESPONSE=$(curl -s -X POST "${OLLAMA_ENDPOINT}/api/generate" \
                    -d "{\"model\": \"${MODEL_NAME}\", \"prompt\": \"Test prompt: describe a rusty sword in one sentence.\", \"stream\": false}" \
                    | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('response','')[:100])" 2>/dev/null)

                if [ -z "${VALIDATION_RESPONSE}" ]; then
                    echo "[$(date)] 🔴 ERROR: Model validation failed."
                else
                    echo "[$(date)] ✅ Model validation passed! Output: ${VALIDATION_RESPONSE}"

                    # Clean up safetensors to save disk
                    echo "[$(date)] Cleaning up intermediate safetensors..."
                    rm -f "${GGUF_DIR}"/*.safetensors
                    rm -f "${GGUF_DIR}"/model.safetensors.index.json

                    # Write completion marker
                    echo "Fine-tune completed: $(date)" > "${RECOVERY_DIR}/FINETUNE_COMPLETE.flag"
                    echo "Model: ${MODEL_NAME}" >> "${RECOVERY_DIR}/FINETUNE_COMPLETE.flag"
                    echo "GGUF: ${GGUF_FILE}" >> "${RECOVERY_DIR}/FINETUNE_COMPLETE.flag"
                fi
            fi
        else
            echo "[$(date)] ERROR: GGUF export failed with exit code ${EXPORT_EXIT}"
        fi

        # Unlock pipeline
        rm -f "${WORKSPACE}/training/TRAINING_IN_PROGRESS.flag"
        sleep ${CHECK_INTERVAL}
        continue
    fi

    # ─── Phase 1: Normal flag-based training ──────────────────────────────
    FLAG_FILE=$(find "${WORKSPACE}/training" -name "READY_TO_FINETUNE.flag" | head -n 1)

    if [ -n "${FLAG_FILE}" ] && [ -f "${FLAG_FILE}" ]; then
        TRAIN_DIR=$(dirname "${FLAG_FILE}")
        PROJECT_ID=$(basename "${TRAIN_DIR}")
        
        # If it's directly in training, fall back to generic
        if [ "${PROJECT_ID}" = "training" ]; then
            MODEL_NAME="perry-writer:latest"
        else
            MODEL_NAME="a.perry:latest"
        fi
        
        TRAINING_DATA="${TRAIN_DIR}/training_data.jsonl"
        OUTPUT_DIR="${TRAIN_DIR}/lora-adapter"
        GGUF_DIR="${TRAIN_DIR}/gguf"
        OLLAMA_ENDPOINT="http://ollama:11434"

        echo ""
        echo "[$(date)] FLAG DETECTED in ${TRAIN_DIR} — Starting LoRA fine-tune for ${MODEL_NAME}..."
        
        # Check training data exists and has enough records
        if [ ! -f "${TRAINING_DATA}" ]; then
            echo "[$(date)] Training data not found at ${TRAINING_DATA}. Waiting..."
            sleep ${CHECK_INTERVAL}
            continue
        fi
        
        LINE_COUNT=$(wc -l < "${TRAINING_DATA}")
        echo "[$(date)] Training pairs found: ${LINE_COUNT}"
        
        if [ "${LINE_COUNT}" -lt 20 ]; then
            echo "[$(date)] Not enough training pairs (${LINE_COUNT} < 20). Waiting for more..."
            sleep ${CHECK_INTERVAL}
            continue
        fi
        
        # Remove flag to prevent re-triggering during training
        rm -f "${FLAG_FILE}"
        
        # Create lock flag so the pipeline engine knows to pause
        touch "${WORKSPACE}/training/TRAINING_IN_PROGRESS.flag"
        
        echo "[$(date)] Flushing VRAM on Writer GPU before training..."
        curl -s -X POST http://ollama:11434/api/generate -d '{"model": "hf.co/bartowski/magnum-32b-v2-GGUF:Q5_K_M", "keep_alive": 0}' > /dev/null
        
        echo "[$(date)] Starting fine-tuning with ${LINE_COUNT} training pairs..."
        
        # Run fine-tuning (trains LoRA + merges weights to safetensors)
        # NOTE: The GGUF export inside finetune.py may fail due to llama.cpp deps.
        # If it does, the recovery loop above will handle it on the next cycle.
        python3 /trainer/finetune.py \
            --data "${TRAINING_DATA}" \
            --output "${OUTPUT_DIR}" \
            --gguf-output "${GGUF_DIR}"
        
        TRAIN_EXIT=$?
        
        if [ ${TRAIN_EXIT} -eq 0 ]; then
            echo "[$(date)] Fine-tuning + GGUF export complete!"
            
            GGUF_FILE=$(ls "${GGUF_DIR}"/*.gguf 2>/dev/null | head -1)
            
            if [ -n "${GGUF_FILE}" ]; then
                echo "[$(date)] Creating Ollama model from GGUF: ${GGUF_FILE}"
                
                # Copy GGUF to Ollama shared storage
                SAFE_MODEL_NAME=$(echo "${MODEL_NAME}" | tr -d ' ' | tr ':' '-')
                cp "${GGUF_FILE}" "/ollama_storage/models/${SAFE_MODEL_NAME}.gguf"

                cat > /tmp/perry-tuned.Modelfile <<MODELEOF
FROM /root/.ollama/models/${SAFE_MODEL_NAME}.gguf

TEMPLATE """{{- if .System }}
<|im_start|>system
{{ .System }}<|im_end|>
{{- end }}
{{- if .Prompt }}
<|im_start|>user
{{ .Prompt }}<|im_end|>
{{- end }}
<|im_start|>assistant
"""

SYSTEM """
You are a Deep POV science fiction author fine-tuned on Perry calibration data.
NEVER use filter words (felt, thought, noticed, realized, saw, looked at, stared, remembered, imagined).
NEVER name emotions — show them through somatic markers only.
NEVER attribute internal states to non-POV characters.
"""

PARAMETER temperature 0.85
PARAMETER top_p 0.95
PARAMETER top_k 40
PARAMETER repeat_penalty 1.15
PARAMETER num_ctx 32768
MODELEOF

                echo "[$(date)] Registering model with Ollama via API..."
                MODELFILE_CONTENT=$(python3 -c "import sys,json; print(json.dumps(open('/tmp/perry-tuned.Modelfile').read()))")
                curl -s -X POST "${OLLAMA_ENDPOINT}/api/create" \
                    -H "Content-Type: application/json" \
                    -d "{\"name\": \"${MODEL_NAME}\", \"modelfile\": ${MODELFILE_CONTENT}}"

                echo "[$(date)] Model ${MODEL_NAME} registered in Ollama!"
                
                # Update user.json natively (shared volume)
                echo "[$(date)] Auto-switching dashboard config to use new custom author..."
                python3 -c "import json, os; f='/workspace/.config/user.json'; d=json.load(open(f)) if os.path.exists(f) else {'ai':{'ollama':{}}}; d.setdefault('ai',{}).setdefault('ollama',{})['model']='${MODEL_NAME}'; json.dump(d, open(f,'w'), indent=2)"
                
                echo "[$(date)] Validating new model integrity..."
                VALIDATION_RESPONSE=$(curl -s -X POST "${OLLAMA_ENDPOINT}/api/generate" \
                    -d "{\"model\": \"${MODEL_NAME}\", \"prompt\": \"Test prompt: describe a rusty sword in one sentence.\", \"stream\": false}" \
                    | python3 -c "import sys,json; print(json.loads(sys.stdin.read()).get('response','')[:100])" 2>/dev/null)
                
                if [ -z "${VALIDATION_RESPONSE}" ]; then
                    echo "[$(date)] 🔴 ERROR: Model validation failed."
                    echo "Validation failed at $(date)" > "${FLAG_FILE}"
                else
                    echo "[$(date)] ✅ Model validation passed! Output: ${VALIDATION_RESPONSE}"
                    
                    echo "[$(date)] Cleaning up intermediate safetensors..."
                    rm -f "${GGUF_DIR}"/*.safetensors
                    rm -f "${GGUF_DIR}"/model.safetensors.index.json
                    
                    echo "Fine-tune completed: $(date)" > "${TRAIN_DIR}/FINETUNE_COMPLETE.flag"
                    echo "Model: ${MODEL_NAME}" >> "${TRAIN_DIR}/FINETUNE_COMPLETE.flag"
                    echo "Training pairs used: ${LINE_COUNT}" >> "${TRAIN_DIR}/FINETUNE_COMPLETE.flag"
                    echo "GGUF: ${GGUF_FILE}" >> "${TRAIN_DIR}/FINETUNE_COMPLETE.flag"
                fi
            else
                echo "[$(date)] ERROR: No GGUF file found in ${GGUF_DIR}"
                echo "[$(date)] Will attempt recovery on next cycle..."
            fi
        else
            echo "[$(date)] ERROR: Fine-tuning failed with exit code ${TRAIN_EXIT}"
            # Check if merge succeeded but GGUF failed (partial success)
            HAS_SAFETENSORS=$(ls "${GGUF_DIR}"/*.safetensors 2>/dev/null | head -1)
            if [ -n "${HAS_SAFETENSORS}" ]; then
                echo "[$(date)] Merged safetensors detected — recovery will run on next cycle."
            else
                # Full failure — restore flag so it retries training
                echo "Previous run failed at $(date)" > "${FLAG_FILE}"
            fi
        fi
        
        # Remove lock flag whether success or failure
        rm -f "${WORKSPACE}/training/TRAINING_IN_PROGRESS.flag"
    else
        echo "[$(date)] Watching... (no flag yet)"
    fi
    
    sleep ${CHECK_INTERVAL}
done
