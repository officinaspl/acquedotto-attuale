$ErrorActionPreference = "Stop"

$ProjectDir = "C:\Users\Stefano\Desktop\acquedotto attuale"
$GitExe = "C:\Program Files\Git\cmd\git.exe"
$LogFile = "C:\Users\Stefano\Desktop\acquedotto attuale\autosave_runtime.log"
$PollSeconds = 60

Set-Location $ProjectDir

function Write-Log {
    param([string]$Msg)
    $line = ("[{0:yyyy-MM-dd HH:mm:ss}] {1}" -f (Get-Date), $Msg)
    Add-Content -Path $LogFile -Value $line
}

function Ensure-GitKeepForEmptyDirs {
    $created = 0
    $dirs = Get-ChildItem -Path $ProjectDir -Directory -Recurse -Force | Where-Object {
        $_.FullName -notlike "$ProjectDir\.git*"
    }

    foreach ($dir in $dirs) {
        $items = Get-ChildItem -Path $dir.FullName -Force
        if ($items.Count -eq 0) {
            $gitkeep = Join-Path $dir.FullName ".gitkeep"
            if (-not (Test-Path $gitkeep)) {
                New-Item -Path $gitkeep -ItemType File -Force | Out-Null
                $created++
            }
        }
    }

    if ($created -gt 0) {
        Write-Log "created .gitkeep in $created empty folder(s)"
    }
}

function Invoke-AutoSave {
    Ensure-GitKeepForEmptyDirs

    & $GitExe add -A
    if ($LASTEXITCODE -ne 0) { Write-Log "git add failed"; return }

    & $GitExe diff --cached --quiet
    if ($LASTEXITCODE -eq 0) {
        Write-Log "no changes"
        return
    }

    $msg = "Auto backup {0:dd/MM/yyyy HH:mm:ss}" -f (Get-Date)
    & $GitExe commit -m $msg
    if ($LASTEXITCODE -ne 0) { Write-Log "git commit failed"; return }

    & $GitExe push
    if ($LASTEXITCODE -eq 0) {
        Write-Log "push ok: $msg"
    } else {
        Write-Log "git push failed"
    }
}

try {
    Write-Log "autosave poller started"
    while ($true) {
        Start-Sleep -Seconds $PollSeconds
        Invoke-AutoSave
    }
}
finally {
    Write-Log "autosave poller stopped"
}
