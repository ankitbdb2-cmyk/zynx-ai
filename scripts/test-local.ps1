# PropMind local smoke test
$base = if ($env:PORT) { "http://localhost:$($env:PORT)" } else { "http://localhost:8080" }
Write-Host "Testing $base ..."

$h = Invoke-RestMethod "$base/health"
Write-Host "[OK] Health: $($h.status) | DB: $($h.persistence.dbPath)"
Write-Host "     Properties: $($h.persistence.propertyCount) | Leads: $($h.persistence.leadCount)"

$homeHtml = (Invoke-WebRequest "$base/" -UseBasicParsing).Content
if ($homeHtml -match 'design-system' -and $homeHtml -match 'pm-mesh') { Write-Host "[OK] Homepage premium UI" }
else { Write-Host "[FAIL] Homepage UI"; exit 1 }

$admin = (Invoke-WebRequest "$base/admin.html" -UseBasicParsing).Content
if ($admin -match 'smart-paste') { Write-Host "[OK] Admin smart paste UI" }
else { Write-Host "[FAIL] Admin smart paste"; exit 1 }

Write-Host "All local checks passed."
