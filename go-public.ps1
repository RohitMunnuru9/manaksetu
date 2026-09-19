<#
    Publish ManakSetu on one public HTTPS address, and keep it there.

    Only the dashboard (port 3000) is tunnelled. The analysis API is reached
    through it, because next.config.mjs proxies /api/* to localhost:8000. One
    address, no CORS, and nothing to re-configure when a tunnel rotates.

    The supervisor loop is the point of this script: if the tunnel process dies
    -- the usual cause being the laptop losing its network for a moment -- it is
    started again within seconds, without touching the API, the dashboard or the
    language model. Those keep running throughout, so nothing is reloaded and no
    analysis is lost.

    Usage:
        .\go-public.ps1                       Cloudflare quick tunnel.
                                              Free, no account. The address
                                              changes whenever the tunnel is
                                              recreated, so share it late.

        .\go-public.ps1 -Ngrok <domain>       ngrok with your reserved free
                                              static domain, e.g.
                                              -Ngrok manaksetu.ngrok-free.dev
                                              The address NEVER changes, which
                                              is what you want if the link is
                                              printed or shared in advance.
                                              Needs: ngrok config add-authtoken
#>

param(
    # A reserved ngrok domain. Claim one free at dashboard.ngrok.com/domains.
    [string]$Ngrok = "",
    [int]$Port = 3000,
    # Seconds between liveness checks.
    [int]$CheckEvery = 10
)

$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

function Write-Step($m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Write-Ok($m)   { Write-Host "    OK  $m" -ForegroundColor Green }
function Write-Warn($m) { Write-Host "    --  $m" -ForegroundColor Yellow }

function Resolve-Tool($name, $candidates) {
    # winget puts a tool on the system PATH, but a shell opened before the
    # install keeps a stale copy of it, so check the install locations too.
    $cmd = Get-Command $name -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    foreach ($c in $candidates) { if (Test-Path $c) { return $c } }
    return $null
}

$cloudflared = Resolve-Tool "cloudflared" @(
    "$env:ProgramFiles\cloudflared\cloudflared.exe",
    "${env:ProgramFiles(x86)}\cloudflared\cloudflared.exe",
    "$env:LOCALAPPDATA\Programs\cloudflared\cloudflared.exe"
)
$ngrokExe = Resolve-Tool "ngrok" @(
    "$env:ProgramFiles\ngrok\ngrok.exe",
    "$env:LOCALAPPDATA\Programs\ngrok\ngrok.exe",
    "$env:LOCALAPPDATA\Microsoft\WinGet\Links\ngrok.exe"
)

if ($Ngrok -and -not $ngrokExe) {
    Write-Warn "ngrok not found. Install it with: winget install ngrok.ngrok"
    Write-Warn "Then run once: ngrok config add-authtoken <your token>"
    exit 1
}
if (-not $Ngrok -and -not $cloudflared) {
    Write-Warn "cloudflared not found. Install it with: winget install Cloudflare.cloudflared"
    exit 1
}

# --- Is the dashboard actually up? ---------------------------------------
try {
    Invoke-WebRequest -Uri "http://localhost:$Port" -TimeoutSec 8 -UseBasicParsing | Out-Null
} catch {
    Write-Warn "Nothing is serving http://localhost:$Port."
    Write-Warn "Start the application first:  .\start-demo.ps1"
    exit 1
}
Write-Ok "dashboard is answering on port $Port"

# --- Tunnel lifecycle -----------------------------------------------------
$script:Proc = $null
$script:Url  = $null

function Start-Ngrok {
    $log = Join-Path $env:TEMP "manaksetu-ngrok.log"
    Remove-Item $log -ErrorAction SilentlyContinue
    $args = @("http", "$Port", "--domain", $Ngrok, "--log", "stdout", "--log-format", "logfmt")
    $script:Proc = Start-Process -FilePath $ngrokExe -ArgumentList $args `
        -RedirectStandardOutput $log -WindowStyle Hidden -PassThru
    $script:Url = "https://$Ngrok"
    Start-Sleep -Seconds 4
    return $script:Url
}

function Start-Quick {
    # A fresh log file every time. Re-using one path meant that when a dying
    # cloudflared still held the handle, Remove-Item silently failed and the
    # old address was read back out -- so a rebuilt tunnel was reported as
    # "restored at the same address" while its real address had changed, and
    # the supervisor then health-checked a URL that no longer existed.
    $log = Join-Path $env:TEMP ("manaksetu-tunnel-{0}-{1}.log" -f $Port, [guid]::NewGuid().ToString("N").Substring(0, 8))
    $script:Proc = Start-Process -FilePath $cloudflared `
        -ArgumentList "tunnel","--url","http://localhost:$Port","--no-autoupdate" `
        -RedirectStandardError $log -WindowStyle Hidden -PassThru
    $deadline = (Get-Date).AddSeconds(60)
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 2
        if (Test-Path $log) {
            $m = Select-String -Path $log -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($m) {
                $script:Url = $m.Matches[0].Value
                $script:LogPath = $log
                return $script:Url
            }
        }
    }
    return $null
}

function Start-Public {
    if ($Ngrok) { return Start-Ngrok } else { return Start-Quick }
}

Write-Step "Opening the public address"
$url = Start-Public
if (-not $url) { Write-Warn "could not establish a tunnel"; exit 1 }

Write-Host ""
Write-Host "  PUBLIC   $url" -ForegroundColor Green
if ($Ngrok) {
    Write-Host "           This address is reserved to your account and will not change." -ForegroundColor DarkGray
    Write-Host "           Free ngrok shows visitors a one-click warning page first." -ForegroundColor DarkGray
} else {
    Write-Host "           A quick tunnel gets a new address each time it is recreated," -ForegroundColor DarkGray
    Write-Host "           so share this one shortly before you present." -ForegroundColor DarkGray
}
Write-Host ""
Write-Host "  Watching the tunnel. It will be restarted automatically if the" -ForegroundColor DarkGray
Write-Host "  network drops. Press Ctrl+C to stop publishing." -ForegroundColor DarkGray
Write-Host ""

# --- Supervisor -----------------------------------------------------------
# Two things are checked: that the tunnel process is alive, and that the public
# address actually answers. A process can survive while its connection to the
# edge is gone, which is exactly the case a demonstration cannot afford.
$failures = 0
try {
    while ($true) {
        Start-Sleep -Seconds $CheckEvery

        $alive = $script:Proc -and -not $script:Proc.HasExited
        $answering = $false
        if ($alive) {
            try {
                $r = Invoke-WebRequest -Uri $script:Url -TimeoutSec 15 -UseBasicParsing
                $answering = ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500)
            } catch {
                $answering = $false
            }
        }

        if ($alive -and $answering) {
            if ($failures -gt 0) {
                Write-Ok "$(Get-Date -Format 'HH:mm:ss') back online"
                $failures = 0
            }
            continue
        }

        $failures++
        # One missed check is usually a blip mid-reconnect; cloudflared and
        # ngrok both retry on their own. Only rebuild after it stays down.
        if ($failures -lt 3) {
            Write-Warn "$(Get-Date -Format 'HH:mm:ss') unreachable ($failures/3) - giving it a moment to reconnect"
            continue
        }

        Write-Warn "$(Get-Date -Format 'HH:mm:ss') tunnel is down; rebuilding it"
        if ($script:Proc -and -not $script:Proc.HasExited) {
            Stop-Process -Id $script:Proc.Id -Force -ErrorAction SilentlyContinue
        }
        # Give the process time to release its handles before the replacement
        # starts, and clear any tunnel orphaned by an earlier crash.
        Start-Sleep -Seconds 2
        $new = Start-Public
        $failures = 0
        if ($new) {
            if ($new -ne $url) {
                $url = $new
                Write-Host ""
                Write-Host "  NEW PUBLIC ADDRESS  $url" -ForegroundColor Yellow
                Write-Host "  (a quick tunnel cannot keep its old one - use -Ngrok to avoid this)" -ForegroundColor DarkGray
                Write-Host ""
            } else {
                Write-Ok "restored at the same address"
            }
        } else {
            Write-Warn "could not rebuild yet; will keep trying"
        }
    }
} finally {
    if ($script:Proc -and -not $script:Proc.HasExited) {
        Stop-Process -Id $script:Proc.Id -Force -ErrorAction SilentlyContinue
    }
    Write-Host "`nStopped publishing. The application itself is still running locally." -ForegroundColor DarkGray
}
