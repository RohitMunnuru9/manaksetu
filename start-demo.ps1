<#
    ManakSetu demonstration launcher.

    Starts everything in the right order and refuses to report success until each
    service actually answers. It exists because every failure during development
    was operational rather than logical: a killed dev server leaving a zombie on
    port 3000 so Next silently started on 3001 and the browser showed a stale
    build; a stale .next directory after a production build ran alongside the dev
    server; Ollama not running; the model paged out and costing forty seconds on
    the first request.

    Usage:   powershell -ExecutionPolicy Bypass -File start-demo.ps1
             ... -SkipModel     start without the language model briefing
             ... -Fresh         rebuild the .next cache and reseed the database
             ... -SkipWeb       start only the API and model, leaving port 3000 free
             ... -Public        also publish a public HTTPS URL via Cloudflare
#>

param(
    [switch]$SkipModel,
    [switch]$Fresh,
    # Leave port 3000 alone. Use this when the dashboard is already being served
    # by something else, so the two do not fight over the port.
    [switch]$SkipWeb,
    # Publish a public HTTPS URL through Cloudflare, so the dashboard can be
    # opened from any device rather than only this machine.
    [switch]$Public
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = Join-Path $root "backend\.venv\Scripts\python.exe"
$ollama = Join-Path $env:LOCALAPPDATA "Programs\Ollama\ollama.exe"

function Resolve-Tool($name, $candidates) {
    # A tool installed by winget lands on the system PATH, but a shell opened
    # before the install keeps a stale copy of it -- so check the usual install
    # locations too rather than telling the user to reopen their terminal.
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
    return $null
}

function Start-Tunnel($port, $label) {
    $exe = Resolve-Tool "cloudflared" @(
        "$env:ProgramFiles\cloudflared\cloudflared.exe",
        "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe",
        "$env:LOCALAPPDATA\Programs\cloudflared\cloudflared.exe"
    )
    if (-not $exe) {
        Write-Warn "cloudflared not found. Install it with: winget install Cloudflare.cloudflared"
        return $null
    }
    $log = Join-Path $env:TEMP "manaksetu-tunnel-$port.log"
    Remove-Item $log -ErrorAction SilentlyContinue
    Start-Process -FilePath $exe -ArgumentList "tunnel","--url","http://localhost:$port","--no-autoupdate" `
        -RedirectStandardError $log -WindowStyle Hidden
    $deadline = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 2
        if (Test-Path $log) {
            $match = Select-String -Path $log -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -ErrorAction SilentlyContinue |
                     Select-Object -First 1
            if ($match) {
                $url = $match.Matches[0].Value
                Write-Ok "$label published at $url"
                return $url
            }
        }
    }
    Write-Warn "$label tunnel did not report a URL within 60s"
    return $null
}

function Write-Step($message) { Write-Host "`n==> $message" -ForegroundColor Cyan }
function Write-Ok($message)   { Write-Host "    OK  $message" -ForegroundColor Green }
function Write-Warn($message) { Write-Host "    --  $message" -ForegroundColor Yellow }

function Stop-Port($port) {
    # A dev server killed from an editor can leave the listener behind. Next then
    # picks the next free port and the browser keeps showing the old build.
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($owner in ($conns | Select-Object -ExpandProperty OwningProcess -Unique)) {
        # $pid is a reserved PowerShell variable and cannot be assigned here.
        Write-Warn "port $port was held by PID $owner; stopping it"
        Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue
    }
}

function Wait-For($url, $name, $timeoutSeconds = 120) {
    $deadline = (Get-Date).AddSeconds($timeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $r = Invoke-WebRequest -Uri $url -TimeoutSec 3 -UseBasicParsing
            if ($r.StatusCode -eq 200) { Write-Ok "$name is answering"; return $true }
        } catch { Start-Sleep -Seconds 2 }
    }
    Write-Warn "$name did not answer within ${timeoutSeconds}s"
    return $false
}

# --- Preconditions -------------------------------------------------------
Write-Step "Checking prerequisites"
if (-not (Test-Path $python)) {
    Write-Host "Backend virtualenv missing. Create it with:" -ForegroundColor Red
    Write-Host "  python -m venv backend/.venv" -ForegroundColor Red
    Write-Host "  backend/.venv/Scripts/python.exe -m pip install -r backend/requirements.txt" -ForegroundColor Red
    exit 1
}
Write-Ok "backend virtualenv"

if (-not (Test-Path (Join-Path $root "backend\.env"))) {
    # Without a fixed secret every restart signs the officer out mid-demo.
    Write-Warn "no backend/.env; generating a fixed signing secret so sessions survive restarts"
    & $python -c "import secrets; print('JWT_SECRET=' + secrets.token_urlsafe(48))" | Out-File -FilePath (Join-Path $root "backend\.env") -Encoding ascii
}
Write-Ok "signing secret present"

# --- Clean slate ---------------------------------------------------------
Write-Step "Releasing ports"
if (-not $SkipWeb) { Stop-Port 3000 }
Stop-Port 8000
Write-Ok $(if ($SkipWeb) { "port 8000 free (left 3000 alone)" } else { "ports 3000 and 8000 free" })

if ($Fresh) {
    Write-Step "Fresh start requested"
    Remove-Item (Join-Path $root ".next") -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item (Join-Path $root "backend\manaksetu.db") -Force -ErrorAction SilentlyContinue
    Write-Ok "cleared .next cache and database"
}

# --- Public URLs ---------------------------------------------------------
# Started first: the URLs have to be on disk before the services read them.
# NEXT_PUBLIC_* in particular is baked in when the dashboard compiles.
if ($Public) {
    Write-Step "Publishing public URLs"
    $apiUrl = Start-Tunnel 8000 "API"
    $webUrl = if ($SkipWeb) { $null } else { Start-Tunnel 3000 "Dashboard" }

    if ($apiUrl) {
        Set-Content -Path (Join-Path $root ".env.local") -Encoding ascii -Value @(
            "# Written by start-demo.ps1 -Public. Delete this file to return to",
            "# the purely local setup (http://localhost:8000).",
            "NEXT_PUBLIC_API_URL=$apiUrl/api/v1"
        )
        Write-Ok "dashboard will call $apiUrl/api/v1"
    }
    if ($webUrl) {
        $envFile = Join-Path $root "backend\.env"
        $kept = @(Get-Content $envFile | Where-Object { $_ -notmatch "^CORS_ORIGINS=" })
        Set-Content -Path $envFile -Encoding ascii -Value ($kept + "CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000,$webUrl")
        Write-Ok "API will accept requests from $webUrl"
    }
    $script:PublicWeb = $webUrl
}

# --- Language model ------------------------------------------------------
if (-not $SkipModel) {
    Write-Step "Language model"
    $tags = $null
    try { $tags = Invoke-WebRequest -Uri "http://localhost:11434/api/tags" -TimeoutSec 3 -UseBasicParsing } catch {}
    if (-not $tags) {
        if (Test-Path $ollama) {
            Start-Process -FilePath $ollama -ArgumentList "serve" -WindowStyle Hidden
            Wait-For "http://localhost:11434/api/tags" "Ollama" 60 | Out-Null
        } else {
            Write-Warn "Ollama is not installed; the briefing panel will stay empty (everything else works)"
        }
    } else { Write-Ok "Ollama already running" }
} else {
    Write-Warn "skipping the language model (--SkipModel)"
}

# --- Services ------------------------------------------------------------
Write-Step "Starting the API on port 8000"
Start-Process -FilePath $python `
    -ArgumentList "-m", "uvicorn", "app.main:app", "--port", "8000" `
    -WorkingDirectory (Join-Path $root "backend") -WindowStyle Minimized
$apiUp = Wait-For "http://localhost:8000/api/v1/health" "API" 180

if ($SkipWeb) {
    Write-Warn "not starting the dashboard (--SkipWeb)"
    $webUp = $true
} else {
    Write-Step "Starting the dashboard on port 3000"
    Start-Process -FilePath "npm.cmd" -ArgumentList "run", "dev" -WorkingDirectory $root -WindowStyle Minimized
    $webUp = Wait-For "http://localhost:3000" "Dashboard" 180
}

# --- Summary -------------------------------------------------------------
Write-Step "Ready"
if ($apiUp -and $webUp) {
    Write-Host ""
    Write-Host "  Dashboard   http://localhost:3000" -ForegroundColor White
    Write-Host "  API docs    http://localhost:8000/docs" -ForegroundColor White
    Write-Host ""
    Write-Host "  Officer     officer@manaksetu.gov.in / ManakSetu@2026" -ForegroundColor White
    Write-Host "  Supplier    supplier@example.in     / ManakSetu@2026   (restricted, for the access-control case)" -ForegroundColor White
    Write-Host ""
    if ($script:PublicWeb) {
        Write-Host ""
        Write-Host "  PUBLIC      $($script:PublicWeb)" -ForegroundColor Yellow
        Write-Host "              Live only while this machine and the tunnels stay running." -ForegroundColor DarkGray
    }
    Write-Host ""
    Write-Host "  Demonstration script: see README.md" -ForegroundColor DarkGray
} else {
    Write-Host ""
    Write-Host "  Something did not come up. Check the minimised windows for errors." -ForegroundColor Red
    Write-Host "  If the dashboard is on a port other than 3000, a zombie process held it:" -ForegroundColor Red
    Write-Host "  re-run this script, which clears the port first." -ForegroundColor Red
    exit 1
}
