$wshell = New-Object -ComObject wscript.shell
$prompt = "SYSTEM WAKEUP CALL: You are monitoring the Perry LoRA training pipeline overnight. Please perform a strict audit: 1) Read 'D:\n8n\perry\workspace\training\project-project-93\training_summary.md' and confirm 'verified pairs' are accumulating. 2) Check 'docker logs --tail 50 perry-trainer' for OOM crashes or to see if fine-tuning has started. 3) Check 'docker logs --tail 50 perry' for Librarian Quality Gate failures or Ollama connection drops. If everything is healthy, give a 1-sentence summary. If you detect 0% pass rates, stalled accumulation, or fatal errors, alert me immediately!"

Write-Host "Night Watch Active! Injecting prompt every 30 minutes..." -ForegroundColor Green

while($true) {
    Start-Sleep -Seconds 1800
    $wshell.SendKeys($prompt)
    Start-Sleep -Milliseconds 500
    $wshell.SendKeys("{ENTER}")
}
