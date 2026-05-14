$file = "d:\n8n\workflows\ai_5216perry_uk_anthony_p\personal\1 - Braindump to Dossier.workflow.ts"

$content = Get-Content $file -Raw

Write-Host "Adding numGpu references to workflow 1 model nodes..." -ForegroundColor Cyan

# Workflow 1 uses active_profile, so all nodes should reference it the same way
# Pattern: add numGpu after repeatPenalty in options blocks that use active_profile

$pattern = '("repeatPenalty":\s*"=\{\{\s*\$\(''Universal Config''\)\.item\.json\.active_profile\.parameters\.repeat_penalty\s*\}\}"),(\r?\n\s*\})'
$replacement = '$1,$2            numGpu: "={{ $$(''Universal Config'').item.json.active_profile.parameters.num_gpu }}",$2'

$updated = $content -replace $pattern, $replacement

# Also handle nodes that might use specific profiles (like profiles.creative)
$pattern2 = '("repeatPenalty":\s*"=\{\{\s*\$\(''Universal Config''\)\.item\.json\.profiles\.(\w+)\.parameters\.repeat_penalty\s*\}\}"),(\r?\n\s*\})'
$replacement2 = '$1,$2            numGpu: "={{ $$(''Universal Config'').item.json.profiles.$2.parameters.num_gpu }}",$2'

$updated = $updated -replace $pattern2, $replacement2

if ($content -ne $updated) {
    Set-Content -Path $file -Value $updated -NoNewline
    Write-Host "✅ Updated workflow 1" -ForegroundColor Green
    
    # Verify the change
    $newCount = ([regex]::Matches($updated, 'numGpu:')).Count
    Write-Host "✅ Now has $newCount numGpu references" -ForegroundColor Green
} else {
    Write-Host "⚠️  No changes made" -ForegroundColor Yellow
}
