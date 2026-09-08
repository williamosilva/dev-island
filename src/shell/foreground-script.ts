import { PRODUCT_ID, PRODUCT_NAME } from '../shared/branding';

/** How often the helper samples the foreground window, in milliseconds. */
export const DEFAULT_POLL_INTERVAL_MS = 150;

/**
 * PowerShell helper that reports which window owns the foreground.
 *
 * Windows exposes this only through user32, and Node cannot call it without a
 * native addon, so a single supervised PowerShell process does the P/Invoke and
 * streams one compact JSON object per change on stdout (or the literal `null`
 * when no window owns the foreground). It writes nothing when nothing changed,
 * so an idle desktop costs no traffic at all.
 */
export function buildForegroundScript(pollIntervalMs = DEFAULT_POLL_INTERVAL_MS): string {
  const interval = Math.max(50, Math.round(pollIntervalMs));

  return `# ${PRODUCT_NAME} foreground watcher (${PRODUCT_ID})
# Generated at runtime. Reports the foreground window; changes nothing.

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential)]
public struct DevIslandRect
{
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
}

public static class DevIslandForeground
{
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    public static extern int GetWindowThreadProcessId(IntPtr hWnd, out int processId);

    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool GetWindowRect(IntPtr hWnd, out DevIslandRect rect);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
}
"@

$names = @{}
$last = ''

while ($true) {
  try {
    $handle = [DevIslandForeground]::GetForegroundWindow()
    $line = 'null'

    if ($handle -ne [IntPtr]::Zero) {
      $processId = 0
      [void][DevIslandForeground]::GetWindowThreadProcessId($handle, [ref]$processId)
      $iconic = [DevIslandForeground]::IsIconic($handle)
      $rect = New-Object DevIslandRect
      [void][DevIslandForeground]::GetWindowRect($handle, [ref]$rect)

      if ($names.Count -gt 200) { $names.Clear() }
      if (-not $names.ContainsKey($processId)) {
        $resolved = ''
        try {
          $resolved = (Get-Process -Id $processId -ErrorAction Stop).ProcessName + '.exe'
        } catch {
          $resolved = ''
        }
        $names[$processId] = $resolved
      }

      $caption = New-Object System.Text.StringBuilder 256
      [void][DevIslandForeground]::GetWindowText($handle, $caption, $caption.Capacity)

      $line = [ordered]@{
        pid          = $processId
        windowHandle = '0x' + $handle.ToInt64().ToString('X16')
        processName  = $names[$processId]
        title        = $caption.ToString()
        minimized    = [bool]$iconic
        x            = $rect.Left
        y            = $rect.Top
        width        = $rect.Right - $rect.Left
        height       = $rect.Bottom - $rect.Top
      } | ConvertTo-Json -Compress
    }

    if ($line -ne $last) {
      $last = $line
      [Console]::Out.WriteLine($line)
      [Console]::Out.Flush()
    }
  } catch {
    # Never let a transient failure kill the watcher.
  }

  Start-Sleep -Milliseconds ${interval}
}
`.replace(/\r?\n/g, '\r\n');
}
