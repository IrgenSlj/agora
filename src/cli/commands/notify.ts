import { execFile } from 'node:child_process';
import { ExitCode } from '../exit-codes.js';
import { stringFlag, usageError, writeJson, writeLine } from '../helpers.js';
import type { CommandHandler } from './types.js';

function execFileSafe(
  command: string,
  args: string[],
  options: { timeout: number }
): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function notifyDarwin(title: string, message: string, sound: boolean): Promise<void> {
  const snd = sound ? ' with sound name "default"' : '';
  const script = `display notification "${message}" with title "${title}"${snd}`;
  return execFileSafe('osascript', ['-e', script], { timeout: 5000 });
}

function notifyLinux(title: string, message: string, sound: boolean): Promise<void> {
  const args = [title, message];
  if (sound) args.push('-u', 'critical');
  return execFileSafe('notify-send', args, { timeout: 5000 }).catch(() => {
    throw new Error('notify-send not installed. Try: sudo apt install libnotify-bin');
  });
}

function notifyWindows(title: string, message: string, _sound: boolean): Promise<void> {
  const psScript = `
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null
$template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
$textNodes = $template.GetElementsByTagName("text")
$textNodes.Item(0).AppendChild($template.CreateTextNode($title))
$textNodes.Item(1).AppendChild($template.CreateTextNode($msg))
$toast = [Windows.UI.Notifications.ToastNotification]::new($template)
[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Agora").Show($toast)
`;
  return new Promise((resolve, reject) => {
    execFile(
      'powershell',
      ['-Command', psScript, '-title', title, '-msg', message],
      { timeout: 10000 },
      (error) => {
        if (error) reject(new Error('Windows notifications not available'));
        else resolve();
      }
    );
  });
}

export const commandNotify: CommandHandler = async (parsed, io, style) => {
  const title = stringFlag(parsed, 'title', 't') || 'Agora';
  const message = parsed.args.join(' ');
  const sound = Boolean(parsed.flags.sound);
  const platform = process.platform;

  if (!message) {
    return usageError(
      io,
      'notify requires a message.\nUsage: agora notify <message> [--title "Title"] [--sound]'
    );
  }

  if (parsed.flags.json) {
    writeJson(io.stdout, { platform, title, message, sound });
    return 0;
  }

  try {
    if (platform === 'darwin') {
      await notifyDarwin(title, message, sound);
    } else if (platform === 'linux') {
      await notifyLinux(title, message, sound);
    } else if (platform === 'win32') {
      await notifyWindows(title, message, sound);
    } else {
      writeLine(io.stderr, `Desktop notifications not supported on ${platform}`);
      writeLine(io.stderr, `Message: ${title}: ${message}`);
      return ExitCode.USAGE;
    }
    writeLine(io.stdout, style.dim(`Notification sent: ${title}`));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Failed to send notification';
    return usageError(io, msg);
  }

  return 0;
};
