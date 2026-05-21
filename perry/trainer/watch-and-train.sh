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
# Phase 2: queries the typed pen_names table; the displayName/associatedProjects
# data lives in pen_names.data (JSON column) which is kept in sync by perry's
# bootstrap and by this trainer's record_lora_version() upserts.
lookup_pen_slug() {
    local project_id="$1"
    python3 - "$project_id" <<'PYEOF'
import sys, sqlite3, json, re, os
project_id = sys.argv[1]
db_path = os.environ['PROJECTS_DB']
try:
    db = sqlite3.connect(db_path)
    db.row_factory = sqlite3.Row

    # 1) projects.context.penNameSlug (direct on the project record)
    r = db.execute("SELECT data FROM projects WHERE id = ?", (project_id,)).fetchone()
    ctx_pen_name = None
    if r:
        ctx = (json.loads(r['data']).get('context') or {})
        if ctx.get('penNameSlug'):
            print(ctx['penNameSlug']); sys.exit(0)
        ctx_pen_name = ctx.get('penName')

    # Load all typed pen-name rows once for the remaining lookups.
    try:
        pens = db.execute("SELECT slug, display_name, data FROM pen_names").fetchall()
    except sqlite3.OperationalError:
        pens = []

    # 2) projects.context.penName → pen_names.display_name
    if ctx_pen_name:
        for p in pens:
            if p['display_name'] == ctx_pen_name:
                print(p['slug']); sys.exit(0)
        # Fallback: slugify the display name
        slug = re.sub(r'[^a-z0-9]+', '-', ctx_pen_name.lower()).strip('-')
        if slug:
            print(slug); sys.exit(0)

    # 3) associatedProjects (still nested in pen_names.data)
    for p in pens:
        try:
            doc = json.loads(p['data'] or '{}')
        except json.JSONDecodeError:
            continue
        for ap in doc.get('associatedProjects', []):
            if ap.get('id') == project_id:
                print(p['slug']); sys.exit(0)
except Exception as e:
    print(f"lookup_pen_slug error: {e}", file=sys.stderr)
print('')
PYEOF
}

# Get next LoRA version for a pen slug. Echoes integer.
# Phase 2: reads only from the typed lora_versions table.
next_version() {
    local slug="$1"
    python3 - "$slug" <<'PYEOF'
import sys, sqlite3, os
slug = sys.argv[1]
db = sqlite3.connect(os.environ['PROJECTS_DB'])
db.row_factory = sqlite3.Row
try:
    row = db.execute(
        "SELECT MAX(version) AS v FROM lora_versions WHERE pen_slug = ?",
        (slug,),
    ).fetchone()
    if row and row['v'] is not None:
        print(int(row['v']) + 1); sys.exit(0)
except sqlite3.OperationalError:
    pass  # table not yet created on a fresh install
print(1)
PYEOF
}

# Append a new lora version after a successful train. Phase 2: writes ONLY to
# the typed pen_names + lora_versions tables. The legacy meta['pen_name_records']
# blob is no longer written; perry's bootstrap projects it into the typed tables
# on first boot of an upgraded deployment.
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
base_model = os.environ.get('BASE_MODEL', '')
ver_int = int(version)

# Defensive: ensure typed tables exist even if perry hasn't run migration 4→5
# yet (e.g. trainer boots first on a fresh install). Schema mirrors
# state-store.ts migration; INSERT OR REPLACE keeps writes idempotent.
db.executescript("""
CREATE TABLE IF NOT EXISTS pen_names (
  slug TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  genre_or_series TEXT,
  voice_tagline TEXT,
  base_model TEXT,
  current_lora_version INTEGER,
  created_at TEXT,
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS lora_versions (
  pen_slug TEXT NOT NULL,
  version INTEGER NOT NULL,
  ollama_tag TEXT,
  currently_registered_as TEXT,
  lora_gguf_path TEXT,
  lora_adapter_path TEXT,
  training_pairs INTEGER,
  training_steps INTEGER,
  epochs INTEGER,
  final_loss REAL,
  lora_rank INTEGER,
  max_length INTEGER,
  trained_at TEXT,
  promoted INTEGER DEFAULT 0,
  data TEXT NOT NULL,
  PRIMARY KEY (pen_slug, version)
);
CREATE INDEX IF NOT EXISTS idx_lora_pen ON lora_versions(pen_slug);
""")

entry = {
    'version': ver_int,
    'ollamaTag': tag,
    'loraGgufPath': gguf_path,
    'loraAdapterPath': adapter_path,
    'trainingPairs': int(pairs) if pairs else None,
    'finalLoss': float(loss) if loss else None,
    'trainedAt': trained_at,
    'promoted': True,
}

# Preserve any nested fields already present in pen_names.data
# (voiceBible / characterBible / associatedProjects / etc.) so the trainer
# doesn't strip them while updating the LoRA bookkeeping.
existing = db.execute("SELECT data FROM pen_names WHERE slug = ?", (slug,)).fetchone()
if existing and existing['data']:
    try:
        pen_doc = json.loads(existing['data'])
    except json.JSONDecodeError:
        pen_doc = {}
else:
    pen_doc = {}

pen_doc.setdefault('id', f'pen-{slug}')
pen_doc['slug'] = slug
pen_doc.setdefault('displayName', slug)
pen_doc.setdefault('baseModel', base_model)
pen_doc['currentLoraVersion'] = ver_int
lora_versions_doc = [v for v in pen_doc.get('loraVersions', []) if int(v.get('version', 0)) != ver_int]
lora_versions_doc.append(entry)
pen_doc['loraVersions'] = lora_versions_doc

db.execute("""
    INSERT INTO pen_names (slug, display_name, genre_or_series, voice_tagline,
                           base_model, current_lora_version, created_at, data)
    VALUES (:slug, :display_name, :genre_or_series, :voice_tagline,
            :base_model, :current_lora_version, :created_at, :data)
    ON CONFLICT(slug) DO UPDATE SET
      display_name=excluded.display_name,
      base_model=excluded.base_model,
      current_lora_version=excluded.current_lora_version,
      data=excluded.data
""", {
    'slug': slug,
    'display_name': pen_doc.get('displayName') or slug,
    'genre_or_series': pen_doc.get('genreOrSeries'),
    'voice_tagline': pen_doc.get('voiceTagline'),
    'base_model': pen_doc.get('baseModel') or base_model,
    'current_lora_version': ver_int,
    'created_at': pen_doc.get('createdAt'),
    'data': json.dumps(pen_doc, ensure_ascii=False),
})

db.execute("""
    INSERT INTO lora_versions (pen_slug, version, ollama_tag, currently_registered_as,
                               lora_gguf_path, lora_adapter_path,
                               training_pairs, training_steps, epochs, final_loss,
                               lora_rank, max_length, trained_at, promoted, data)
    VALUES (:pen_slug, :version, :ollama_tag, :currently_registered_as,
            :lora_gguf_path, :lora_adapter_path,
            :training_pairs, :training_steps, :epochs, :final_loss,
            :lora_rank, :max_length, :trained_at, :promoted, :data)
    ON CONFLICT(pen_slug, version) DO UPDATE SET
      ollama_tag=excluded.ollama_tag,
      currently_registered_as=excluded.currently_registered_as,
      lora_gguf_path=excluded.lora_gguf_path,
      lora_adapter_path=excluded.lora_adapter_path,
      training_pairs=excluded.training_pairs,
      final_loss=excluded.final_loss,
      trained_at=excluded.trained_at,
      promoted=excluded.promoted,
      data=excluded.data
""", {
    'pen_slug': slug,
    'version': ver_int,
    'ollama_tag': tag,
    # Hands-off auto-promote: the versioned tag IS the active alias. Perry's
    # pen-aware resolver reads this field to swap the writer model on the next
    # request that carries this pen's slug — no manual user.json edit needed.
    'currently_registered_as': tag,
    'lora_gguf_path': gguf_path,
    'lora_adapter_path': adapter_path,
    'training_pairs': int(pairs) if pairs else None,
    'training_steps': None,
    'epochs': None,
    'final_loss': float(loss) if loss else None,
    'lora_rank': None,
    'max_length': None,
    'trained_at': trained_at,
    'promoted': 1,
    'data': json.dumps(entry, ensure_ascii=False),
})

db.commit()
print(f"typed pen-name tables updated: {tag} (v{version}) for slug '{slug}'")
PYEOF
}

# Get optional per-pen-name Modelfile SYSTEM prompt override. Echoes content
# or empty (caller falls back to the default below). Phase 2: reads from
# pen_names.data (the JSON column on the typed table).
get_system_prompt() {
    local slug="$1"
    python3 - "$slug" <<'PYEOF'
import sys, sqlite3, json, os
slug = sys.argv[1]
db = sqlite3.connect(os.environ['PROJECTS_DB'])
db.row_factory = sqlite3.Row
try:
    r = db.execute("SELECT data FROM pen_names WHERE slug = ?", (slug,)).fetchone()
except sqlite3.OperationalError:
    sys.exit(0)
if not r or not r['data']:
    sys.exit(0)
try:
    doc = json.loads(r['data'])
except json.JSONDecodeError:
    sys.exit(0)
sp = doc.get('modelfileSystemPrompt')
if sp:
    print(sp)
PYEOF
}

# Register Ollama tag via the modern /api/create flow. Args:
#   tag, gguf_path (readable by THIS container), base_model, system_prompt
#
# Ollama 0.18+ deprecated the legacy `{name, modelfile}` body. The modern
# shape requires the adapter to be uploaded as a content-addressed blob first
# (PUT /api/blobs/sha256:<digest>), then a structured POST /api/create with
# `{model, from, adapters, system, template, parameters}`.
ollama_register() {
    local tag="$1" gguf_path="$2" base_model="$3" system_prompt="$4"
    python3 - "$tag" "$gguf_path" "$base_model" "$system_prompt" <<'PYEOF'
import sys, json, hashlib, urllib.request, urllib.error, os, subprocess
tag, gguf_path, base_model, system_prompt = sys.argv[1:5]
endpoint = os.environ['OLLAMA_ENDPOINT']

# 1) SHA256 the adapter GGUF
h = hashlib.sha256()
size = 0
with open(gguf_path, 'rb') as f:
    while True:
        chunk = f.read(1 << 20)
        if not chunk: break
        h.update(chunk)
        size += len(chunk)
digest = h.hexdigest()
print(f"adapter digest sha256:{digest} ({size:,} bytes)", flush=True)

# 2) HEAD blob — skip upload if Ollama already has it
head = urllib.request.Request(
    f"{endpoint}/api/blobs/sha256:{digest}", method='HEAD')
try:
    urllib.request.urlopen(head, timeout=30)
    print("blob already present, skipping upload", flush=True)
except urllib.error.HTTPError as e:
    if e.code != 404:
        print(f"HEAD blob error: HTTP {e.code}", file=sys.stderr); sys.exit(2)
    # 3) PUT blob — STREAMED via curl. Python's urllib reads `data=f` fully
    # into memory before sending, then issues a single 1GB+ socket.sendall()
    # which Ollama frequently closes mid-flight → BrokenPipeError. curl with
    # `--upload-file` streams the body in normal HTTP chunks and survives the
    # 1GB+ adapter blob reliably.
    print("uploading adapter blob (streamed via curl POST)...", flush=True)
    url = f"{endpoint}/api/blobs/sha256:{digest}"
    # Ollama expects POST (not PUT) at /api/blobs/sha256:DIGEST. `--data-binary
    # @file` streams the body; `-H Expect:` disables the 100-continue handshake
    # that some Ollama builds reject; `--fail-with-body` makes non-2xx an
    # error AND prints the response so we know what went wrong.
    proc = subprocess.run([
        'curl', '--silent', '--show-error', '--fail-with-body',
        '--max-time', '1800',
        '-X', 'POST',
        '-H', 'Content-Type: application/octet-stream',
        '-H', 'Expect:',
        '--data-binary', f'@{gguf_path}',
        url,
    ], capture_output=True, text=True)
    if proc.returncode != 0:
        print(f"POST blob curl rc={proc.returncode}: {proc.stderr.strip() or proc.stdout.strip()}",
              file=sys.stderr); sys.exit(2)
    print("blob upload complete", flush=True)

# 4) Modern POST /api/create — structured body, NOT the legacy `modelfile` string.
template = ("{{- if .System }}\n<|im_start|>system\n{{ .System }}<|im_end|>\n"
            "{{- end }}\n{{- if .Prompt }}\n<|im_start|>user\n"
            "{{ .Prompt }}<|im_end|>\n{{- end }}\n<|im_start|>assistant\n")
adapter_basename = os.path.basename(gguf_path)
body = {
    'model': tag,
    'from': base_model,
    'adapters': {adapter_basename: f"sha256:{digest}"},
    'system': system_prompt,
    'template': template,
    'parameters': {
        'temperature': 0.85, 'top_p': 0.95, 'top_k': 40,
        'repeat_penalty': 1.15, 'num_ctx': 32768,
    },
    'stream': False,
}
req = urllib.request.Request(
    f"{endpoint}/api/create", method='POST',
    data=json.dumps(body).encode(),
    headers={'Content-Type': 'application/json'})
try:
    resp = urllib.request.urlopen(req, timeout=1800)
    print(resp.read().decode()[:500])
except urllib.error.HTTPError as e:
    print(f"HTTP {e.code}: {e.read().decode()[:500]}", file=sys.stderr)
    sys.exit(1)
except Exception as e:
    print(f"register error: {e}", file=sys.stderr); sys.exit(2)
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
# Handles two dir-name shapes:
#   project-{id}/  — calibration / pipeline-produced training data
#   pen-{slug}/    — hands-off / manual-fold training data (no project context)
resolve_pen_target() {
    local train_dir="$1"
    local raw_name project_id slug version tag
    raw_name=$(basename "${train_dir}")

    if [[ "${raw_name}" == pen-* ]]; then
        # Direct pen-slug path — no project lookup needed.
        slug="${raw_name#pen-}"
    else
        # Tolerate the existing "project-project-N" double-prefix dir naming
        # (cosmetic upstream bug; tracked separately). Strip ONE leading "project-".
        project_id="${raw_name#project-}"
        [[ "${project_id}" == project-* ]] || project_id="${raw_name}"

        slug=$(lookup_pen_slug "${project_id}")
        if [ -z "${slug}" ]; then
            slug="${DEFAULT_PEN_SLUG}"
            echo "[$(date)] WARN: no pen-name slug for ${project_id}, falling back to '${slug}'" >&2
        fi
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
    if ! cp "${gguf_file}" "/ollama_storage/models/${gguf_basename}"; then
        echo "[$(date)] ERROR: cp to /ollama_storage/models/ failed." >&2
        echo "[$(date)]   The dir must be writable by uid 1000. Fix from the ollama" >&2
        echo "[$(date)]   container: docker exec -u root ollama chown 1000:1000 /root/.ollama/models" >&2
        return 2
    fi

    local system_prompt
    system_prompt=$(get_system_prompt "${slug}")
    [ -z "${system_prompt}" ] && system_prompt="${default_system_prompt}"

    # Pass the GGUF path readable by this container; ollama_register uploads it
    # as a blob to Ollama, then POSTs the structured /api/create body.
    echo "[$(date)] Registering ${tag} with Ollama (blob+create)..."
    if ! ollama_register "${tag}" "${gguf_file}" "${BASE_MODEL}" "${system_prompt}"; then
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

# Preflight: /ollama_storage/models/ must be writable by this user (uid 1000)
# so the finalize cp can succeed. The directory is shared with the ollama
# container, which created it as root. If not writable, log a clear remediation
# instead of letting the cp fail mid-finalize on every cycle.
if [ ! -w /ollama_storage/models ] 2>/dev/null; then
    echo "[$(date)] WARN: /ollama_storage/models/ is not writable by uid $(id -u)." >&2
    echo "[$(date)]   Run: docker exec -u root ollama chown 1000:1000 /root/.ollama/models" >&2
    echo "[$(date)]   Training will run, but finalize will fail until this is fixed." >&2
fi

# Preflight: projects.db must be writable too. record_lora_version() does an
# UPSERT into pen_names + lora_versions; if the file is root-owned (perry runs
# as root) and we're uid 1000, the UPSERT silently fails on commit and the row
# never lands. Surface a remediation hint at boot rather than after a 3-hour
# fit.
if [ -f "${PROJECTS_DB}" ] && [ ! -w "${PROJECTS_DB}" ]; then
    echo "[$(date)] WARN: ${PROJECTS_DB} is not writable by uid $(id -u)." >&2
    echo "[$(date)]   Run: docker exec -u root perry chown 1000:1000 /app/workspace/.config/projects.db" >&2
    echo "[$(date)]   (perry container path; same file appears here as ${PROJECTS_DB}.)" >&2
    echo "[$(date)]   Without write access, the LoRA registers but the DB row won't update." >&2
fi

while true; do
    # ─── Phase 0: Recovery — GGUF export OR finalize/register failure ───
    # Scans both project-*/ (calibration runs) and pen-*/ (manual-fold runs).
    # Two recoverable states:
    #   (a) safetensors merged but no GGUF → re-run export + finalize
    #   (b) GGUF present but no FINETUNE_COMPLETE.flag → finalize_train will
    #       skip the export (already done) and just re-run the Ollama
    #       blob+create register step. Covers broken-pipe / network failures
    #       at the register step without forcing a full retrain.
    RECOVERY_DIR=""
    for dir in "${WORKSPACE}/training"/project-*/ "${WORKSPACE}/training"/pen-*/; do
        [ -d "${dir}" ] || continue
        dir="${dir%/}"
        has_safetensors=$(compgen -G "${dir}/gguf/*.safetensors" > /dev/null 2>&1 && echo y || echo n)
        has_gguf=$(compgen -G "${dir}/gguf/*.gguf"        > /dev/null 2>&1 && echo y || echo n)
        has_complete=$([ -f "${dir}/FINETUNE_COMPLETE.flag" ]              && echo y || echo n)
        if { [ "${has_safetensors}" = "y" ] && [ "${has_gguf}" = "n" ]; } \
           || { [ "${has_gguf}" = "y" ] && [ "${has_complete}" = "n" ]; }; then
            RECOVERY_DIR="${dir}"
            break
        fi
    done

    if [ -n "${RECOVERY_DIR}" ]; then
        echo ""
        echo "[$(date)] RECOVERY candidate: ${RECOVERY_DIR}"
        target=$(resolve_pen_target "${RECOVERY_DIR}")
        slug="${target%%|*}"
        rest="${target#*|}"
        version="${rest%%|*}"
        tag="${rest#*|}"
        echo "[$(date)] Recovery target: slug=${slug} version=${version} tag=${tag}"

        # Manifest gate also applies to recovery — never finalize a model when
        # the pen's manifest isn't ready. Drops a FINETUNE_COMPLETE.flag to suppress
        # the recovery condition until the user explicitly clears it and re-flags.
        MANIFEST_AUDIT_SCRIPT="/workspace/.config/_audit_manifest.py"
        if [ -f "${MANIFEST_AUDIT_SCRIPT}" ]; then
            if ! python3 "${MANIFEST_AUDIT_SCRIPT}" "${slug}" > /tmp/recovery_audit.log 2>&1; then
                echo "[$(date)] RECOVERY BLOCKED: manifest NOT READY for ${slug}."
                echo "[$(date)] Dropping FINETUNE_COMPLETE.flag to suppress further recovery attempts."
                echo "[$(date)] Delete the flag + re-drop READY_TO_FINETUNE.flag when manifest is satisfied."
                touch "${RECOVERY_DIR}/FINETUNE_COMPLETE.flag"
                # Clean up the orphan in-progress flag if any
                rm -f "${WORKSPACE}/training/TRAINING_IN_PROGRESS.flag"
                sleep "${CHECK_INTERVAL}"
                continue
            fi
        fi

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

    # ── Manifest readiness gate ────────────────────────────────────────────
    # Refuse to train unless the pen's pair_manifest_<slug>.json reports READY.
    # _audit_manifest.py exit code is 0 when must_satisfy categories are filled
    # AND total_matched >= min_total_pairs. Otherwise non-zero → skip training,
    # leave flag in place so manifest can fill via worker pipeline.
    MANIFEST_AUDIT_SCRIPT="/workspace/.config/_audit_manifest.py"
    if [ -f "${MANIFEST_AUDIT_SCRIPT}" ]; then
        echo "[$(date)] Checking manifest readiness for slug=${slug}..."
        if python3 "${MANIFEST_AUDIT_SCRIPT}" "${slug}" > /tmp/manifest_audit.log 2>&1; then
            echo "[$(date)] Manifest READY — proceeding to train"
        else
            echo "[$(date)] Manifest NOT READY — refusing to train. Leaving flag in place."
            tail -20 /tmp/manifest_audit.log | sed 's/^/  /'
            sleep "${CHECK_INTERVAL}"
            continue
        fi
    else
        echo "[$(date)] WARN: no manifest audit script at ${MANIFEST_AUDIT_SCRIPT} — training without manifest gate"
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
        echo "[$(date)] ✅ ${tag} registered."

        # Phase B — post-training audit. Long-running (~6 min for 12 prompts).
        # The audit service handles auto-promotion internally when the
        # calibration project's promoteOnComplete flag is set AND the audit
        # passes. We just fire-and-monitor.
        PERRY_API="${PERRY_API:-http://perry:3847}"
        echo "[$(date)] Triggering Phase B audit on ${tag}..."
        AUDIT_RESPONSE=$(curl -fsS --max-time 1800 -X POST \
            "${PERRY_API}/api/pens/${slug}/audit/${version}" \
            -H "Content-Type: application/json" -d '{}' \
            2>&1 || echo '{"error":"curl failed"}')
        echo "[$(date)] Audit result: ${AUDIT_RESPONSE}"
    else
        echo "[$(date)] ❌ Finalize failed for ${tag}." >&2
    fi

    rm -f "${WORKSPACE}/training/TRAINING_IN_PROGRESS.flag"
    sleep "${CHECK_INTERVAL}"
done
