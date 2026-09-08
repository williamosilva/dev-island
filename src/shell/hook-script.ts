import { PRODUCT_ID, PRODUCT_NAME } from '../shared/branding';
import { PROTOCOL_VERSION } from '../localipc/protocol';
import { psSingleQuote } from './powershell-quote';

export interface HookScriptOptions {
  /** Short pipe name (without the \\.\pipe\ prefix). */
  pipeShortName: string;
  /** File holding the per-user pipe token. */
  tokenFilePath: string;
  /** Where a report is dropped when the app is not running yet. */
  pendingFilePath: string;
  /** Describes how to start the background process. */
  launcherFilePath: string;
  /** Guards against two prompts launching the app at the same time. */
  launchLockPath: string;
}

/**
 * Content of the PowerShell script we own.
 *
 * The profile only dot-sources this file, so future changes to the hook do not
 * require touching the user's profile again. The script:
 *   - does nothing outside the VS Code integrated terminal;
 *   - wraps (never replaces) an existing `prompt` function;
 *   - reports the current directory whenever it changes, leaving it to the app
 *     to walk up to the nearest package.json and decide whether it is a project;
 *   - starts the app silently when nobody is listening, handing the report over
 *     through a file instead of blocking the prompt on retries;
 *   - fails silently, so a stopped app can never break someone's shell.
 */
export function buildHookScript(options: HookScriptOptions): string {
  const pipe = psSingleQuote(options.pipeShortName);
  const tokenFile = psSingleQuote(options.tokenFilePath);
  const pendingFile = psSingleQuote(options.pendingFilePath);
  const launcherFile = psSingleQuote(options.launcherFilePath);
  const launchLock = psSingleQuote(options.launchLockPath);

  const script = `# ${PRODUCT_NAME} shell hook (${PRODUCT_ID})
# Generated file - do not edit. Remove with: ${PRODUCT_ID} remove-shell-integration

if ($env:TERM_PROGRAM -ne 'vscode') { return }

$global:DevIslandPipeName = ${pipe}
$global:DevIslandTokenFile = ${tokenFile}
$global:DevIslandPendingFile = ${pendingFile}
$global:DevIslandLauncherFile = ${launcherFile}
$global:DevIslandLaunchLock = ${launchLock}
if (-not (Test-Path variable:global:DevIslandLastPath)) { $global:DevIslandLastPath = '' }

function global:Test-DevIslandPipe {
  try {
    $pipes = [System.IO.Directory]::GetFileSystemEntries('\\\\.\\pipe\\')
    foreach ($entry in $pipes) {
      if ($entry.EndsWith($global:DevIslandPipeName)) { return $true }
    }
  } catch { }
  return $false
}

# Resolves the VS Code window that owns the foreground right now. The type is
# compiled on first use, so a session that never enters a project pays nothing.
function global:Get-DevIslandVsCodeWindow {
  try {
    if (-not ('DevIslandWin' -as [type])) {
      Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class DevIslandWin
{
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int processId);
}
'@
    }

    $handle = [DevIslandWin]::GetForegroundWindow()
    if ($handle -eq [IntPtr]::Zero) { return $null }

    $ownerId = 0
    [void][DevIslandWin]::GetWindowThreadProcessId($handle, [ref]$ownerId)
    $owner = Get-Process -Id $ownerId -ErrorAction Stop

    # Only a real VS Code window may be associated with a project. If Chrome or
    # anything else is in front, the report carries no handle and the existing
    # association is left untouched.
    if ($owner.ProcessName + '.exe' -ine 'Code.exe') { return $null }

    return '0x' + $handle.ToInt64().ToString('X16')
  } catch {
    return $null
  }
}

# Writes the report to disk and starts the app. The app reads the file on
# startup, so the prompt never waits for the process to come up.
function global:Start-DevIslandProcess {
  param(
    [Parameter(Mandatory = $true)][string] $ProjectPath,
    [Parameter(Mandatory = $true)][int] $ShellPid,
    $WindowHandle
  )

  try {
    $pending = [ordered]@{
      cwd          = $ProjectPath
      shellPid     = $ShellPid
      windowHandle = $WindowHandle
      at           = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    } | ConvertTo-Json -Compress
    # WriteAllText emits UTF-8 without a BOM; Set-Content would add one and the
    # JSON parser on the other side would choke on it. The token is deliberately
    # not written here: it belongs on the pipe, not in a second file.
    [System.IO.File]::WriteAllText($global:DevIslandPendingFile, $pending)
  } catch {
    return
  }

  try {
    # A launch attempt in the last few seconds is already on its way, so two
    # prompts drawing at once cannot start two processes.
    if (Test-Path -LiteralPath $global:DevIslandLaunchLock) {
      $age = (Get-Date) - (Get-Item -LiteralPath $global:DevIslandLaunchLock).LastWriteTime
      if ($age.TotalSeconds -lt 15) { return }
    }
    Set-Content -LiteralPath $global:DevIslandLaunchLock -Value (Get-Date -Format o) -Encoding UTF8

    if (-not (Test-Path -LiteralPath $global:DevIslandLauncherFile)) { return }
    $launcher = Get-Content -LiteralPath $global:DevIslandLauncherFile -Raw | ConvertFrom-Json
    if (-not $launcher.electron -or -not $launcher.appRoot) { return }

    # Electron checks this by presence, not by value: an inherited variable
    # would start a plain Node process with no window at all. Some editors and
    # CLI tools set it, so it is cleared rather than trusted.
    Remove-Item -Path 'env:ELECTRON_RUN_AS_NODE' -ErrorAction SilentlyContinue

    # Any environment the launcher recorded (an isolated data directory, for
    # instance) has to reach the process we are about to start.
    if ($launcher.env) {
      foreach ($entry in $launcher.env.PSObject.Properties) {
        Set-Item -Path ('env:' + $entry.Name) -Value $entry.Value
      }
    }

    # A detached GUI process: no console window is created. The path is quoted
    # because Start-Process would otherwise split it on spaces.
    $rootArgument = '"' + $launcher.appRoot + '"'
    Start-Process -FilePath $launcher.electron -ArgumentList $rootArgument -WindowStyle Hidden -ErrorAction Stop | Out-Null
  } catch {
    # The pending file is already written; the next prompt tries again.
  }
}

function global:Send-DevIslandLocation {
  param([Parameter(Mandatory = $true)][string] $ProjectPath)

  $client = $null
  $writer = $null
  try {
    if (-not (Test-Path -LiteralPath $global:DevIslandTokenFile)) { return }
    $token = (Get-Content -LiteralPath $global:DevIslandTokenFile -Raw -ErrorAction Stop).Trim()
    if ([string]::IsNullOrWhiteSpace($token)) { return }

    $handle = Get-DevIslandVsCodeWindow

    # Nobody listening: hand the report over and bring the app up.
    if (-not (Test-DevIslandPipe)) {
      Start-DevIslandProcess -ProjectPath $ProjectPath -ShellPid $PID -WindowHandle $handle
      return
    }

    $payload = [ordered]@{
      v            = ${PROTOCOL_VERSION}
      token        = $token
      type         = 'activate'
      cwd          = $ProjectPath
      shellPid     = $PID
      windowHandle = $handle
    } | ConvertTo-Json -Compress

    $client = New-Object System.IO.Pipes.NamedPipeClientStream(
      '.', $global:DevIslandPipeName, [System.IO.Pipes.PipeDirection]::Out)
    $client.Connect(300)
    $writer = New-Object System.IO.StreamWriter($client)
    $writer.AutoFlush = $true
    $writer.WriteLine($payload)
  } catch {
    # A stopped app must never break the prompt.
  } finally {
    if ($writer) { try { $writer.Dispose() } catch { } }
    if ($client) { try { $client.Dispose() } catch { } }
  }
}

# Preserve whatever prompt the user (or another tool) already defined.
if (-not (Test-Path function:global:DevIslandOriginalPrompt)) {
  $existingPrompt = Get-Command prompt -CommandType Function -ErrorAction SilentlyContinue
  if ($existingPrompt) {
    Set-Item -Path function:global:DevIslandOriginalPrompt -Value $existingPrompt.ScriptBlock
  } else {
    Set-Item -Path function:global:DevIslandOriginalPrompt -Value {
      "PS $($executionContext.SessionState.Path.CurrentLocation)$('>' * ($nestedPromptLevel + 1)) "
    }
  }

  function global:prompt {
    try {
      $location = Get-Location
      if ($location.Provider.Name -eq 'FileSystem') {
        $current = $location.ProviderPath
        if ($current -and $current -ne $global:DevIslandLastPath) {
          $global:DevIslandLastPath = $current
          # Every directory is reported: the app walks up to the nearest
          # package.json and ignores anything that is not a project.
          Send-DevIslandLocation -ProjectPath $current
        }
      }
    } catch { }

    # Stored as a function, so it is invoked by name (never through &).
    DevIslandOriginalPrompt
  }
}
`;

  // Always emit CRLF: this is a Windows PowerShell file, and the source
  // above may be checked out with either line ending.
  return script.replace(/\r?\n/g, '\r\n');
}
