param(
    [string]$message = "受付時間を教えて"
)

$clinicId = "hiroo-ladies"
$uri = "http://localhost:3001/chat"

$body = @{
    clinicId = $clinicId
    message  = $message
} | ConvertTo-Json -Compress

$res = Invoke-WebRequest -UseBasicParsing `
    -Uri $uri `
    -Method POST `
    -ContentType "application/json" `
    -Body $body

$json = $res.Content | ConvertFrom-Json

Write-Host ""
Write-Host "==== ANSWER ====" -ForegroundColor Cyan
Write-Host $json.answer_text

Write-Host ""
Write-Host "==== LINKS ====" -ForegroundColor Yellow
$json.links | Format-Table label,url -AutoSize

Write-Host ""
Write-Host "==== CATEGORY ====" -ForegroundColor Green
Write-Host $json.category
