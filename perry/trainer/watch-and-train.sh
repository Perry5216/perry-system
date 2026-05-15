#!/bin/bash
# P.E.R.R.Y. Auto-Trainer — watch-and-train.sh (v2: pen-name aware)
#
# Polls for READY_TO_FINETUNE.flag every 5 minutes. Resolves the pen-name slug
# for the training directory from projects.db (via meta['pen_name_records'] +
# projects.context.penNameSlug), then registers the new LoRA as
# perry-{slug}:v{N} where {N} is the next unused version. Does NOT overwrite
# previous LoRAs and does NOT auto-switch user.json — writer model selection
# is a deliberate user choice.
#
# Recovery: if merged safetensors exist but no .gguf, skips training and
# jumps to GGUF export + Ollama registration.

set -uo pipefail

WORKSPACE="/workspace"
PROJECTS_DB="${WORKSPACE}/.config/projects.db"
OLLAMA_ENDPOINT="${OLLAMA_ENDPOINT:-http://ollama:11434}"
BASE_MODEL="${BASE_MODEL:-hf.co/bartowski/magnum-32b-v2-GGUF:Q5_K_M}"
CHECK_INTERVAL="${CHECK_INTERVAL:-300}"
DEFAULT_PEN_SLUG="${DEFAULT_PEN_SLUG:-default}"
MIN_TRAINING_PAIRS="${MIN_TRAINING_PAIRS:-20}"

export PROJECTS_DB BASE_MODEL OLLAMA_ENDPOINT

# ═════════════════════════════════════════════════════════════════════════
# Helpers (all use python3 for JSON safety + sqlite3 access)
# ═════════════════════════════════════════════════════════════════════════

# Look up pen-name slug for a project ID. Echoes slug to stdout or empty.
lookup_pen_slug() {
    local project_id="$1"
    python3 - "$project_id" <<'PYEOF'
import sys, sqlite3, json, re, os
project_id = sys.argv[1]
db_path = os.environ['PROJECTS_DB']
try:
    db = sqlite3.connect(db_path)
    db.row_factory = sqlite3.Row
    # 1) projects.context.penNameSlug
    r = db.execute("SELECT data FROM projects WHERE id = ?", (project_id,)).fetchone()
    if r:
        ctx = (json.loads(r['data']).get('context') or {})
        if ctx.get('penNameSlug'):
            print(ctx['penNameSlug']); sys.exit(0)
        name = ctx.get('penName')
        if name:
            m = db.execute("SELECT value FROM meta WHERE key='pen_name_records'").fetchone()
            if m:
                for pn in json.loads(m['value']).get('penNames', []):
                    if pn.get('displayName') == name:
                        print(pn['slug']); sys.exit(0)
            slug = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
            if slug:
                print(slug); sys.exit(0)
    # 2) meta['pen_name_records'].associatedProjects
    m = db.execute("SELECT value FROM meta WHERE key='pen_name_records'").fetchone()
    if m:
        for pn in json.loads(m['value']).get('penNames', []):
            for ap in pn.get('associatedProjects', []):
                if ap.get('id') == project_id:
                    print(pn['slug']); sys.exit(0)
except Exception as e:
    print(f"lookup_pen_slug error: {e}", file=sys.stderr)
print('')
PYEOF
}

# Get next LoRA version for a pen slug. Echoes integer.
next_version() {
    local slug="$1"
    python3 - "$slug" <<'PYEOF'
import sys, sqlite3, json, os
slug = sys.argv[1]
db = sqlite3.connect(os.environ['PROJECTS_DB'])
db.row_factory = sqlite3.Row
m = db.execute("SELECT value FROM meta WHERE key='pen_name_records'").fetchone()
if not m:
    print(1); sys.exit(0)
for pn in json.loads(m['value']).get('penNames', []):
    if pn.get('slug') == slug:
        versions = [int(v.get('version', 0)) for v in pn.get('loraVersions', [])]
        print(max(versions) + 1 if versions else 1); sys.exit(0)
print(1)
PYEOF
}

# Append a new lora version to meta after a successful train.
record_lora_version() {
    local slug="$1" version="$2" tag="$3"
    local gguf_path="$4" adapter_path="$5"
    local training_pairs="$6" final_loss="$7" trained_at="$8"
    python3 - "$slug" "$version" "$tag" "$gguf_path" "$adapter_path" \
               "$training_pairs" "$final_loss" "$trained_at" <<'PYEOF'
import sys, sqlite3, json, os
slug, version, tag, gguf_path, adapter_path, pairs, loss, trained_at = sys.argv[1:9]
db = sqlite3.connect(os.environ['PROJECTS_DB'])
db.row_factory = sqlite3.Row
m = db.execute("SELECT value FROM meta WHERE key='pen_name_records'").fetchone()
rec = json.loads(m['value']) if m else {'version': 1, 'penNames': []}
entry = {
    'version': int(version),
    'ollamaTag': tag,
    'loraGgufPath': gguf_path,
    'loraAdapterPath': adapter_path,
    'trainingPairs': int(pairs) if pairs else None,
    'finalLoss': float(loss) if loss else None,
    'trainedAt': trained_at,
    'promoted': True,
}
matched = False
for pn in rec.get('penNames', []):
    if pn.get('slug') == slug:
        pn.setdefault('loraVersions', []).append(entry)
        pn['currentLoraVersion'] = int(version)
        matched = True
        break
if not matched:
    rec.setdefault('penNames', []).append({
        'id': f'pen-{slug}', 'slug': slug, 'displayName': slug,
        'baseModel': os.environ.get('BASE_MODEL', ''),
        'loraVersions': [entry],
        'currentLoraVersion': int(version),
    })
db.execute("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)",
           ('pen_name_records', json.dumps(rec, ensure_ascii=False)))
db.commit()
print(f"meta record updated: {tag} (v{version}) for slug '{slug}'")
PYEOF
}

# Get optional per-pen-name Modelfile SYSTEM prompt override. Echoes content
# or empty (caller falls back to the default below).
get_system_prompt() {
    local slug="$1"
    python3 - "$slug" <<'PYEOF'
import sys, sqlite3, json, os
slug = sys.argv[1]
db = sqlite3.connect(os.environ['PROJECTS_DB'])
db.row_factory = sqlite3.Row
m = db.execute("SELECT value FROM meta WHERE key='pen_name_records'").fetchone()
if not m:
    sys.exit(0)
for pn in json.loads(m['value']).get('penNames', []):
    if pn.get('slug') == slug:
        sp = pn.get('modelfileSystemPrompt')
        if sp:
            print(sp)
        break
PYEOF
}

# Build the Modelfile text. Args: adapter_basename, system_prompt
build_modelfile() {
    local adapter_basename="$1" system_prompt="$2"
    cat <<MODELFILE_EOF
FROM ${BASE_MODEL}
ADAPTER /root/.ollama/models/${adapter_basename}

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
${system_prompt}
"""

PARAMETER temperature 0.85
PARAMETER top_p 0.95
PARAMETER top_k 40
PARAMETER repeat_penalty 1.15
PARAMETER num_ctx 32768
MODELFILE_EOF
}

# Register Ollama tag via /api/create. Args: tag, modelfile_path.
ollama_register() {
    local tag="$1" mf_path="$2"
    python3 - "$tag" "$mf_path" <<'PYEOF'
import sys, json, urllib.request, urllib.error, os
tag, mf_path = sys.argv[1:3]
with open(mf_path) as f:
    modelfile = f.read()
body = json.dumps({'name': tag, 'modelfile': modelfile}).encode()
req = urllib.request.Request(
    f"{os.environ['OLLAMA_ENDPOINT']}/api/create",
    data=body, method='POST',
    headers={'Content-Type': 'application/json'})
try:
    resp = urllib.request.urlopen(req, timeout=600)
    print(resp.read().decode()[:500])
except urllib.error.HTTPError as e:
    print(f"HTTP {e.code}: {e.read().decode()[:500]}", file=sys.stderr)
    sys.exit(1)
except Exception as e:
    print(f"register error: {e}", file=sys.stderr)
    sys.exit(2)
PYEOF
}

# Validate model by generating a short test prompt. Args: tag.
ollama_validate() {
    local tag="$1"
    python3 - "$tag" <<'PYEOF'
import sys, json, urllib.request, os
tag = sys.argv[1]
body = json.dumps({
    'model': tag,
    'prompt': 'Test: describe a rusty sword in one sentence.',
    'stream': False
}).encode()
try:
    req = urllib.request.Request(
        f"{os.environ['OLLAMA_ENDPOINT']}/api/generate",
        data=body, method='POST',
        headers={'Content-Type': 'application/json'})
    resp = urllib.request.urlopen(req, timeout=180)
    out = json.loads(resp.read()).get('response', '')[:160]
    if out.strip():
        print(out); sys.exit(0)
    print('(empty response)', file=sys.stderr); sys.exit(2)
except Exception as e:
    print(f"validate error: {e}", file=sys.stderr); sys.exit(1)
PYEOF
}

# Extract training stats from a dir. Echoes "pairs|loss" (either may be empty).
get_training_stats() {
    local train_dir="$1"
    local pairs="" loss=""
    if [ -f "${train_dir}/training_data.jsonl" ]; then
        pairs=$(wc -l < "${train_dir}/training_data.jsonl" 2>/dev/null || echo "")
    fi
    if [ -f "${train_dir}/training_summary.md" ]; then
        loss=$(grep -oE 'Final Loss: [0-9.]+' "${train_dir}/training_summary.md" 2>/dev/null \
               | grep -oE '[0-9.]+' \
               | head -1 || echo "")
    fi
    echo "${pairs}|${loss}"
}

# Resolve (slug, version, tag) for a training dir. Echoes "slug|version|tag".
resolve_pen_target() {
    local train_dir="$1"
    local raw_name project_id slug version tag
    raw_name=$(basename "${train_dir}")
    # Tolerate the existing "project-project-N" double-prefix dir naming
    # (cosmetic upstream bug; tracked separately). Strip ONE leading "project-".
    project_id="${raw_name#project-}"
    [[ "${project_id}" == project-* ]] || project_id="${raw_name}"

    slug=$(lookup_pen_slug "${project_id}")
    if [ -z "${slug}" ]; then
        slug="${DEFAULT_PEN_SLUG}"
        echo "[$(date)] WARN: no pen-name slug for ${project_id}, falling back to '${slug}'" >&2
    fi
    version=$(next_version "${slug}")
    tag="perry-${slug}:v${version}"
    echo "${slug}|${version}|${tag}"
}

# Common post-train: export GGUF, register, validate, record. Args:
# train_dir, slug, version, tag. Returns 0 on success.
finalize_train() {
    local train_dir="$1" slug="$2" version="$3" tag="$4"
    local gguf_dir="${train_dir}/gguf"
    local adapter_dir="${train_dir}/lora-adapter"
    local gguf_basename="perry-${slug}-v${version}-lora.gguf"
    local gguf_file="${gguf_dir}/${gguf_basename}"
    local default_system_prompt="You are a Deep POV author fine-tuned on Perry calibration data.
NEVER use filter words (felt, thought, noticed, realized, saw, looked at, stared, remembered, imagined).
NEVER name emotions — show them through somatic markers only.
NEVER attribute internal states to non-POV characters."

    mkdir -p "${gguf_dir}"

    # GGUF export (skip if already present — recovery path)
    if [ ! -f "${gguf_file}" ]; then
        echo "[$(date)] Exporting LoRA adapter -> GGUF (${gguf_basename})..."
        python3 /opt/llama.cpp/convert_lora_to_gguf.py \
            "${adapter_dir}" \
            --outfile "${gguf_file}" \
            --outtype f16
        local export_exit=$?
        if [ ${export_exit} -ne 0 ] || [ ! -f "${gguf_file}" ]; then
            echo "[$(date)] ERROR: GGUF export failed (exit=${export_exit})" >&2
            return 1
        fi
    else
        echo "[$(date)] GGUF already present: ${gguf_file}"
    fi

    echo "[$(date)] Copying GGUF to Ollama shared storage..."
    cp "${gguf_file}" "/ollama_storage/models/${gguf_basename}"

    local system_prompt
    system_prompt=$(get_system_prompt "${slug}")
    [ -z "${system_prompt}" ] && system_prompt="${default_system_prompt}"

    local mf_path="/tmp/perry-${slug}-v${version}.Modelfile"
    build_modelfile "${gguf_basename}" "${system_prompt}" > "${mf_path}"

    echo "[$(date)] Registering ${tag} with Ollama..."
    if ! ollama_register "${tag}" "${mf_path}"; then
        echo "[$(date)] ERROR: Ollama registration failed for ${tag}" >&2
        return 2
    fi

    echo "[$(date)] Validating ${tag}..."
    local validation
    validation=$(ollama_validate "${tag}")
    local validate_exit=$?
    if [ ${validate_exit} -ne 0 ]; then
        echo "[$(date)] ERROR: Validation failed for ${tag} (exit=${validate_exit})" >&2
        return 3
    fi
    echo "[$(date)] Validation output: ${validation}"

    # Record in meta
    local stats pairs loss
    stats=$(get_training_stats "${train_dir}")
    pairs="${stats%%|*}"
    loss="${stats##*|}"
    record_lora_version "${slug}" "${version}" "${tag}" \
        "${gguf_file}" "${adapter_dir}" "${pairs}" "${loss}" \
        "$(date -Iseconds)"

    # Completion marker
    {
        echo "Fine-tune completed: $(date -Iseconds)"
        echo "Pen slug: ${slug}"
        echo "Version:  ${version}"
        echo "Tag:      ${tag}"
        echo "GGUF:     ${gguf_file}"
        echo "Pairs:    ${pairs}"
        echo "Loss:     ${loss}"
    } > "${train_dir}/FINETUNE_COMPLETE.flag"

    # Tidy intermediate safetensors only after validation passes
    rm -f "${gguf_dir}"/*.safetensors
    rm -f "${gguf_dir}/model.safetensors.index.json"

    echo "[$(date)] ${tag} ready."
    echo "[$(date)] NOTE: writer model NOT auto-switched. To use this LoRA,"
    echo "[$(date)]   set user.json ai.ollama.model = \"${tag}\""
    echo "[$(date)]   (or pick it in the dashboard model picker)."
    return 0
}

# ═════════════════════════════════════════════════════════════════════════
# Main loop
# ═════════════════════════════════════════════════════════════════════════

echo "=========================================="
echo " P.E.R.R.Y. Auto-Trainer v2 — Watching..."
echo " GPU:               CUDA_VISIBLE_DEVICES=${CUDA_VISIBLE_DEVICES:-?}"
echo " Base model:        ${BASE_MODEL}"
echo " Interval:          ${CHECK_INTERVAL}s"
echo " Default pen slug:  ${DEFAULT_PEN_SLUG}"
echo " Projects DB:       ${PROJECTS_DB}"
echo " Min training pairs:${MIN_TRAINING_PAIRS}"
echo "=========================================="
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader 2>/dev/null || true

while true; do
    # ─── Phase 0: GGUF-only recovery ────────────────────────────────────
    RECOVERY_DIR=""
    for dir in "${WORKSPACE}/training"/project-*/; do
        [ -d "${dir}" ] || continue
        dir="${dir%/}"
        if compgen -G "${dir}/gguf/*.safetensors" > /dev/null 2>&1 \
           && ! compgen -G "${dir}/gguf/*.gguf" > /dev/null 2>&1; then
            RECOVERY_DIR="${dir}"
            break
        fi
    done

    if [ -n "${RECOVERY_DIR}" ]; then
        echo ""
        echo "[$(date)] RECOVERY: merged safetensors without GGUF in ${RECOVERY_DIR}"
        target=$(resolve_pen_target "${RECOVERY_DIR}")
        slug="${target%%|*}"
        rest="${target#*|}"
        version="${rest%%|*}"
        tag="${rest#*|}"
        echo "[$(date)] Recovery target: slug=${slug} version=${version} tag=${tag}"

        touch "${WORKSPACE}/training/TRAINING_IN_PROGRESS.flag"
        echo "[$(date)] Flushing VRAM..."
        curl -fsS -X POST "${OLLAMA_ENDPOINT}/api/generate" \
            -H "Content-Type: application/json" \
            --data "$(python3 -c "import json,os; print(json.dumps({'model':os.environ['BASE_MODEL'],'keep_alive':0}))")" \
            > /dev/null || true

        if finalize_train "${RECOVERY_DIR}" "${slug}" "${version}" "${tag}"; then
            echo "[$(date)] Recovery complete: ${tag}"
        else
            echo "[$(date)] Recovery failed for ${RECOVERY_DIR}" >&2
        fi
        rm -f "${WORKSPACE}/training/TRAINING_IN_PROGRESS.flag"
        sleep "${CHECK_INTERVAL}"
        continue
    fi

    # ─── Phase 1: Flag-based training ────────────────────────────────────
    FLAG_FILE=""
    while IFS= read -r f; do
        FLAG_FILE="$f"
        break
    done < <(find "${WORKSPACE}/training" -name "READY_TO_FINETUNE.flag" -type f 2>/dev/null)

    if [ -z "${FLAG_FILE}" ] || [ ! -f "${FLAG_FILE}" ]; then
        echo "[$(date)] Watching... (no flag)"
        sleep "${CHECK_INTERVAL}"
        continue
    fi

    TRAIN_DIR=$(dirname "${FLAG_FILE}")
    echo ""
    echo "[$(date)] FLAG DETECTED in ${TRAIN_DIR}"

    target=$(resolve_pen_target "${TRAIN_DIR}")
    slug="${target%%|*}"
    rest="${target#*|}"
    version="${rest%%|*}"
    tag="${rest#*|}"
    echo "[$(date)] Target: slug=${slug} version=${version} tag=${tag}"

    TRAINING_DATA="${TRAIN_DIR}/training_data.jsonl"
    OUTPUT_DIR="${TRAIN_DIR}/lora-adapter"
    GGUF_DIR="${TRAIN_DIR}/gguf"

    if [ ! -f "${TRAINING_DATA}" ]; then
        echo "[$(date)] No training_data.jsonl. Waiting..."
        sleep "${CHECK_INTERVAL}"
        continue
    fi
    LINE_COUNT=$(wc -l < "${TRAINING_DATA}")
    echo "[$(date)] Training pairs: ${LINE_COUNT}"
    if [ "${LINE_COUNT}" -lt "${MIN_TRAINING_PAIRS}" ]; then
        echo "[$(date)] Not enough pairs (<${MIN_TRAINING_PAIRS}). Waiting..."
        sleep "${CHECK_INTERVAL}"
        continue
    fi

    # Remove flag now so re-triggers won't fire during training
    rm -f "${FLAG_FILE}"
    touch "${WORKSPACE}/training/TRAINING_IN_PROGRESS.flag"

    echo "[$(date)] Flushing VRAM..."
    curl -fsS -X POST "${OLLAMA_ENDPOINT}/api/generate" \
        -H "Content-Type: application/json" \
        --data "$(python3 -c "import json,os; print(json.dumps({'model':os.environ['BASE_MODEL'],'keep_alive':0}))")" \
        > /dev/null || true

    export PYTORCH_CUDA_ALLOC_CONF="expandable_segments:True"

    echo "[$(date)] Starting fine-tune (${LINE_COUNT} pairs)..."
    python3 /trainer/finetune.py \
        --data "${TRAINING_DATA}" \
        --output "${OUTPUT_DIR}" \
        --gguf-output "${GGUF_DIR}"
    TRAIN_EXIT=$?

    if [ ${TRAIN_EXIT} -ne 0 ]; then
        echo "[$(date)] ❌ Fine-tune failed (exit=${TRAIN_EXIT})" >&2
        # If safetensors exist, recovery loop will retry; else restore flag.
        if compgen -G "${GGUF_DIR}/*.safetensors" > /dev/null 2>&1; then
            echo "[$(date)] Merged safetensors present — recovery will pick this up next cycle."
        else
            echo "Previous run failed at $(date -Iseconds), exit=${TRAIN_EXIT}" > "${FLAG_FILE}"
        fi
        rm -f "${WORKSPACE}/training/TRAINING_IN_PROGRESS.flag"
        sleep "${CHECK_INTERVAL}"
        continue
    fi

    echo "[$(date)] Fine-tune complete. Finalizing as ${tag}..."
    if finalize_train "${TRAIN_DIR}" "${slug}" "${version}" "${tag}"; then
        echo "[$(date)] ✅ ${tag} promoted."
    else
        echo "[$(date)] ❌ Finalize failed for ${tag}." >&2
    fi

    rm -f "${WORKSPACE}/training/TRAINING_IN_PROGRESS.flag"
    sleep "${CHECK_INTERVAL}"
done
