# Reproduces the production "d1 migrations apply --remote" step against a
# throwaway D1 database in a personal sandbox Cloudflare account.
# Never points at production: the database name is generated here and the
# database is deleted at the end, even on failure.
#
# Usage (token and account come from the environment, never from arguments):
#   $env:CLOUDFLARE_API_TOKEN = '<sandbox token>'; $env:CLOUDFLARE_ACCOUNT_ID = '<sandbox account>'
#   pwsh scripts/remote-repro.ps1 -Version 3.99.0
param([Parameter(Mandatory)] [string] $Version)
$ErrorActionPreference = 'Stop'
if (-not $env:CLOUDFLARE_API_TOKEN -or -not $env:CLOUDFLARE_ACCOUNT_ID) { throw 'Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID first.' }
$env:CI = 'true'; $env:WRANGLER_SEND_METRICS = 'false'
$repo = Split-Path $PSScriptRoot -Parent
$name = "ci-sandbox-$($Version -replace '\.', '-')-$(Get-Random -Maximum 99999)"
$work = Join-Path $env:TEMP $name
$api = "https://api.cloudflare.com/client/v4/accounts/$($env:CLOUDFLARE_ACCOUNT_ID)/d1/database"
$headers = @{ Authorization = "Bearer $($env:CLOUDFLARE_API_TOKEN)" }
New-Item -ItemType Directory -Force (Join-Path $work 'migrations') | Out-Null
function Wr([string[]] $WrArgs) {
  Push-Location $work
  try { & npx --yes "wrangler@$Version" @WrArgs 2>&1 | ForEach-Object { Write-Host "    $_" }; return $LASTEXITCODE } finally { Pop-Location }
}
$db = $null
try {
  "== [$Version] create $name"
  $created = Invoke-RestMethod -Method Post -Headers $headers -ContentType 'application/json' -Uri $api -Body (@{ name = $name; primary_location_hint = 'apac' } | ConvertTo-Json)
  $db = $created.result.uuid
  @"
name = "ci-sandbox"
compatibility_date = "2025-05-01"
[[d1_databases]]
binding = "DB"
database_name = "$name"
database_id = "$db"
migrations_dir = "migrations"
"@ | Set-Content -Encoding utf8 (Join-Path $work 'wrangler.toml')
  Copy-Item (Join-Path $repo 'migrations/0001_lab.sql') (Join-Path $work 'migrations')
  "== [$Version] stage 1: apply 0001 only (production state)"; $c = Wr @('d1', 'migrations', 'apply', $name, '--remote'); "  exit=$c"
  Copy-Item (Join-Path $repo 'migrations/0002_html_artifact.sql'), (Join-Path $repo 'migrations/0003_html_frames.sql') (Join-Path $work 'migrations')
  "== [$Version] migrations list --remote"; $c = Wr @('d1', 'migrations', 'list', $name, '--remote'); "  exit=$c"
  "== [$Version] migrations apply --remote (0002, 0003)"; $apply = Wr @('d1', 'migrations', 'apply', $name, '--remote'); "  exit=$apply"
  foreach ($s in 'watermelon-test', 'endless-runner') {
    "== [$Version] seed $s"; $c = Wr @('d1', 'execute', $name, '--remote', '--file', (Join-Path $repo "seed/$s/seed.sql")); "  exit=$c"
  }
  "== [$Version] row counts"; $c = Wr @('d1', 'execute', $name, '--remote', '--command', "SELECT scene, COUNT(*) AS results FROM lab_results GROUP BY scene"); "  exit=$c"
  "RESULT [$Version] apply_exit=$apply"
} finally {
  if ($db) { Invoke-RestMethod -Method Delete -Headers $headers -Uri "$api/$db" | Out-Null; "== [$Version] deleted $name" }
  Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}
