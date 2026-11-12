$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot

function Refresh-NodePath {
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $commonNodePath = Join-Path $env:ProgramFiles 'nodejs'
    $localNodePath = Join-Path $env:LOCALAPPDATA 'Programs\nodejs'
    $env:Path = @($machinePath, $userPath, $commonNodePath, $localNodePath) -join ';'
}

function Get-NpmCommand {
    $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($npmCommand) { return $npmCommand.Source }
    return $null
}

function Test-NodeReady {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $nodeCommand -or -not (Get-NpmCommand)) { return $false }
    $versionText = (& $nodeCommand.Source --version).Trim().TrimStart('v')
    $versionParts = $versionText.Split('.')
    $majorVersion = 0
    if (-not [int]::TryParse($versionParts[0], [ref]$majorVersion)) { return $false }
    return $majorVersion -ge 20
}

try {
    Set-Location $projectRoot
    Write-Host ''
    Write-Host 'Scalar TDS Lab setup' -ForegroundColor Green
    Write-Host 'This installs Node.js (if needed), project packages, and the production app files.'
    Write-Host ''

    Refresh-NodePath
    if (-not (Test-NodeReady)) {
        $wingetCommand = Get-Command winget.exe -ErrorAction SilentlyContinue
        if (-not $wingetCommand) {
            Start-Process 'https://nodejs.org/en/download'
            throw 'Windows Package Manager (winget) was not found. Install the Node.js LTS Windows installer from the page that opened, then run Install Scalar again.'
        }

        Write-Host 'Installing Node.js LTS. Windows may ask you to approve the installer.' -ForegroundColor Yellow
        & $wingetCommand.Source install --id OpenJS.NodeJS.LTS --exact --accept-package-agreements --accept-source-agreements --silent
        Refresh-NodePath
        if (-not (Test-NodeReady)) {
            throw 'Node.js 20 or later did not become available. Complete any Windows installer prompt, restart Windows if needed, then run Install Scalar again.'
        }
    }

    $npmPath = Get-NpmCommand
    Write-Host ("Using Node.js " + (& node.exe --version)) -ForegroundColor Green
    Write-Host 'Installing project packages. This first step needs an internet connection...' -ForegroundColor Yellow
    & $npmPath install
    if ($LASTEXITCODE -ne 0) { throw 'Package installation did not finish. Check the internet connection and run Install Scalar again.' }

    Write-Host ''
    Write-Host 'Preparing the app...' -ForegroundColor Yellow
    & $npmPath run build
    if ($LASTEXITCODE -ne 0) { throw 'The app could not be built. Check the messages above and run Install Scalar again.' }

    $desktop = [Environment]::GetFolderPath('Desktop')
    $shell = New-Object -ComObject WScript.Shell
    $launchShortcut = $shell.CreateShortcut((Join-Path $desktop 'Scalar Lab.lnk'))
    $launchShortcut.TargetPath = Join-Path $projectRoot 'Launch Scalar.bat'
    $launchShortcut.WorkingDirectory = $projectRoot
    $launchShortcut.Description = 'Open the Scalar TDS Lab dashboard'
    $launchShortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,14"
    $launchShortcut.Save()

    $stopShortcut = $shell.CreateShortcut((Join-Path $desktop 'Stop Scalar Lab.lnk'))
    $stopShortcut.TargetPath = Join-Path $projectRoot 'Stop Scalar.bat'
    $stopShortcut.WorkingDirectory = $projectRoot
    $stopShortcut.Description = 'Stop the local Scalar TDS Lab server'
    $stopShortcut.IconLocation = "$env:SystemRoot\System32\shell32.dll,131"
    $stopShortcut.Save()

    Write-Host ''
    Write-Host 'Setup is complete.' -ForegroundColor Green
    Write-Host 'Use the new "Scalar Lab" desktop icon whenever you want to open the dashboard.'
    Write-Host 'The "Stop Scalar Lab" desktop icon shuts down the local server when you are finished.'
    Write-Host ''
    Read-Host 'Press Enter to close this setup window' | Out-Null
    exit 0
}
catch {
    Write-Host ''
    Write-Host ('Setup could not finish: ' + $_.Exception.Message) -ForegroundColor Red
    Write-Host 'No experiment files were changed by this setup step.'
    Write-Host ''
    Read-Host 'Press Enter to close this setup window' | Out-Null
    exit 1
}
