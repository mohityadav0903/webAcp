import { execFile } from 'node:child_process';
import { platform } from 'node:os';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Native OS folder dialog — returns absolute path or null if cancelled. */
export async function pickFolderNative(): Promise<string | null> {
  const os = platform();

  try {
    if (os === 'darwin') {
      const { stdout } = await execFileAsync('osascript', [
        '-e',
        'POSIX path of (choose folder with prompt "Select project folder for WebACP")',
      ]);
      const path = stdout.trim();
      return path || null;
    }

    if (os === 'linux') {
      try {
        const { stdout } = await execFileAsync('zenity', [
          '--file-selection',
          '--directory',
          '--title=Select project folder for WebACP',
        ]);
        const path = stdout.trim();
        return path || null;
      } catch {
        try {
          const { stdout } = await execFileAsync('kdialog', [
            '--getexistingdirectory',
            process.env.HOME ?? '.',
            '--title',
            'Select project folder for WebACP',
          ]);
          const path = stdout.trim();
          return path || null;
        } catch {
          return null;
        }
      }
    }

    if (os === 'win32') {
      const script = [
        'Add-Type -AssemblyName System.Windows.Forms',
        '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
        '$d.Description = "Select project folder for WebACP"',
        'if ($d.ShowDialog() -eq "OK") { $d.SelectedPath }',
      ].join('; ');
      const { stdout } = await execFileAsync('powershell', ['-NoProfile', '-Command', script]);
      const path = stdout.trim();
      return path || null;
    }
  } catch {
    return null;
  }

  return null;
}
