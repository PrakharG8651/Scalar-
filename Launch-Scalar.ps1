$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$logsPath = Join-Path $projectRoot 'logs'
$pidPath = Join-Path $logsPath 'scalar-server.pid'
$serverScript = Join-Path $projectRoot 'server\index.mjs'

function Get-ScalarStatus([int]$Port) {
    try {
        $status = Invoke-RestMethod -Uri "http://localhost:${Port}/api/status" -Method Get -TimeoutSec 2
        if ($null -ne $status.viewers -and $null -ne $status.experiments) { return $status }
    }
    catch { }
    return $null
}

function Test-PortAvailable([int]$Port) {
    $listener = $null
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $Port)
        $listener.Start()
        return $true
    }
    catch { return $false }
    finally { if ($listener) { $listener.Stop() } }
}

function Refresh-NodePath {
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $commonNodePath = Join-Path $env:ProgramFiles 'nodejs'
    $localNodePath = Join-Path $env:LOCALAPPDATA 'Programs\nodejs'
    $env:Path = @($machinePath, $userPath, $commonNodePath, $localNodePath) -join ';'
}

try {
    Refresh-NodePath
    if (-not (Test-Path (Join-Path $projectRoot 'node_modules')) -or -not (Test-Path (Join-Path $projectRoot 'dist\index.html'))) {
        Write-Host 'First-time setup is needed. Starting the installer...' -ForegroundColor Yellow
        $installerPath = Join-Path $projectRoot 'Install-Scalar.ps1'
        $installerArgs = "-NoLogo -NoProfile -ExecutionPolicy Bypass -File `"$installerPath`""
        $installerProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList $installerArgs -Wait -PassThru
        if ($installerProcess.ExitCode -ne 0) { exit 1 }
        Refresh-NodePath
    }

    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $nodeCommand) {
        Write-Host 'Node.js is missing. Double-click "Install Scalar.bat" first.' -ForegroundColor Red
        Read-Host 'Press Enter to close this window' | Out-Null
        exit 1
    }

    New-Item -ItemType Directory -Path $logsPath -Force | Out-Null
    $port = $null
    $status = $null
    Write-Host 'Checking for an existing Scalar server and a free port...' -ForegroundColor Cyan
    foreach ($candidatePort in 4174..4194) {
        if (Test-PortAvailable -Port $candidatePort) {
            $port = $candidatePort
            break
        }
        # Only make an HTTP request when a listener already owns the port.
        # Probing every free port over HTTP can leave the launcher looking blank
        # while each request waits for its timeout.
        $candidateStatus = Get-ScalarStatus -Port $candidatePort
        if ($candidateStatus) {
            $port = $candidatePort
            $status = $candidateStatus
            break
        }
    }
    if (-not $port) { throw 'Ports 4174 through 4194 are already in use. Close another app or ask your lab administrator for help.' }

    if (-not $status) {
        Write-Host "Starting the Scalar server on port $port..." -ForegroundColor Cyan
        $env:PORT = [string]$port
        $stdoutPath = Join-Path $logsPath 'scalar-server.log'
        $stderrPath = Join-Path $logsPath 'scalar-server-error.log'
        $serverProcess = Start-Process -FilePath $nodeCommand.Source `
            -ArgumentList ('"' + $serverScript + '"') `
            -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru `
            -RedirectStandardOutput $stdoutPath -RedirectStandardError $stderrPath
        Set-Content -LiteralPath $pidPath -Value $serverProcess.Id -Encoding ascii

        # Confirm startup from Node's listen callback instead of making a
        # loopback HTTP request. Managed Windows environments can deny local
        # TCP clients even when Node successfully binds the server port.
        for ($attempt = 0; $attempt -lt 20; $attempt++) {
            Start-Sleep -Milliseconds 500
            if ($serverProcess.HasExited) { break }
            if (Test-Path $stdoutPath) {
                $startupOutput = Get-Content -LiteralPath $stdoutPath -Raw -ErrorAction SilentlyContinue
                if ($startupOutput -match "Scalar LAN server listening on http://0\.0\.0\.0:$port\b") {
                    $status = @{ viewers = 0; experiments = 0 }
                    break
                }
            }
        }
    }

    if (-not $status) {
        $detail = ''
        $errorLog = Join-Path $logsPath 'scalar-server-error.log'
        if (Test-Path $errorLog) { $detail = (Get-Content -LiteralPath $errorLog -Tail 8) -join [Environment]::NewLine }
        if (-not $detail) {
            $outputLog = Join-Path $logsPath 'scalar-server.log'
            if (Test-Path $outputLog) { $detail = (Get-Content -LiteralPath $outputLog -Tail 8) -join [Environment]::NewLine }
        }
        throw "The Scalar server did not start on port $port. $detail"
    }

    $serverUrl = "http://localhost:$port"
    Start-Process $serverUrl
    $addresses = [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces() |
        Where-Object { $_.OperationalStatus -eq 'Up' } |
        ForEach-Object { $_.GetIPProperties().UnicastAddresses } |
        Where-Object { $_.Address.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork -and $_.Address.ToString() -match '^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)' } |
        ForEach-Object { $_.Address.ToString() } |
        Select-Object -Unique

    Write-Host ''
    Write-Host 'Scalar TDS Lab is open.' -ForegroundColor Green
    Write-Host "This computer: $serverUrl"
    $networkAddressText = ''
    if ($addresses) {
        Write-Host 'For another device on the same Wi-Fi, use:'
        $networkAddressText = ($addresses | ForEach-Object { "http://${_}:$port" }) -join "`r`n"
        foreach ($address in $addresses) { Write-Host "  http://${address}:$port" }
    }
    Write-Host 'Keep this computer on while other lab devices are viewing the live feed.'
    Write-Host 'When finished, double-click "Stop Scalar Lab" on the desktop.'
    Write-Host ''
    Add-Type -AssemblyName System.Windows.Forms
    $message = "Dashboard opened in your browser.`r`n`r`nThis computer: $serverUrl"
    if ($networkAddressText) { $message += "`r`n`r`nFor other devices on this Wi-Fi:`r`n$networkAddressText" }
    $message += "`r`n`r`nKeep this computer on during the lab. Use the Stop Scalar Lab desktop icon when finished."
    [System.Windows.Forms.MessageBox]::Show($message, 'Scalar TDS Lab is ready', [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    exit 0
}
catch {
    Write-Host ''
    Write-Host ('Scalar could not start: ' + $_.Exception.Message) -ForegroundColor Red
    Write-Host 'If Windows Firewall asks, allow Node.js on your Private network so lab devices on the same Wi-Fi can connect.'
    Write-Host ''
    Read-Host 'Press Enter to close this window' | Out-Null
    exit 1
}
