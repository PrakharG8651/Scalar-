$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$pidPath = Join-Path $projectRoot 'logs\scalar-server.pid'
$serverScript = Join-Path $projectRoot 'server\index.mjs'

try {
    if (-not (Test-Path -LiteralPath $pidPath)) {
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.MessageBox]::Show('Scalar is not currently running from this launcher.', 'Scalar TDS Lab', [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
        exit 0
    }

    $serverPid = 0
    if (-not [int]::TryParse((Get-Content -LiteralPath $pidPath -Raw).Trim(), [ref]$serverPid)) {
        Remove-Item -LiteralPath $pidPath -Force
        throw 'The saved server process ID was invalid.'
    }

    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $serverPid" -ErrorAction SilentlyContinue
    if ($processInfo -and $processInfo.Name -ieq 'node.exe' -and $processInfo.CommandLine -like "*$serverScript*") {
        Stop-Process -Id $serverPid -Force
        Write-Host 'Scalar server stopped.' -ForegroundColor Green
    }
    else {
        Write-Host 'The saved Scalar server process is no longer running.' -ForegroundColor Yellow
    }
    Remove-Item -LiteralPath $pidPath -Force -ErrorAction SilentlyContinue
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show('Scalar server stopped.', 'Scalar TDS Lab', [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null
    exit 0
}
catch {
    Write-Host ('Could not stop Scalar: ' + $_.Exception.Message) -ForegroundColor Red
    Read-Host 'Press Enter to close this window' | Out-Null
    exit 1
}
