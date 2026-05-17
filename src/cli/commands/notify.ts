import { execSync } from 'node:child_process';
import { stringFlag, writeLine, writeJson, usageError } from '../helpers.js';
import type { CommandHandler } from './types.js';

function notifyDarwin(title: string, message: string, sound: boolean): void {
  const snd = sound ? 'with sound name "default"' : '';
  const script = `display notification "${message.replace(/"/g, '\\"')}" with title "${title.replace(/"/g, '\\"')}" ${snd}`;
  execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, { timeout: 5000 });
}

function notifyLinux(title: string, message: string, sound: boolean): void {
  try {
    execSync(`notify-send "${title.replace(/"/g, '\\"')}" "${message.replace(/"/g, '\\"')}" ${sound ? '-u critical' : ''}`, { timeout: 5000 });
  } catch {
    throw new Error('notify-send not installed. Try: sudo apt install libnotify-bin');
  }
}

function notifyWindows(title: string, message: string, _sound: boolean): void {
  const psCmd = `[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] > $null; $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02); $textNodes = $template.GetElementsByTagName("text"); $textNodes.Item(0).AppendChild($template.CreateTextNode("${title.replace(/"/g, '`"')}")); $textNodes.Item(1).AppendChild($template.CreateTextNode("${message.replace(/"/g, '`"')}")); $toast = [Windows.UI.Notifications.ToastNotification]::new($template); [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier("Agora").Show($toast)`;
  try {
    execSync(`powershell -Command "${psCmd.replace(/"/g, '\\"')}"`, { timeout: 10000 });
  } catch {
    throw new Error('Windows notifications not available');
  }
}

export const commandNotify: CommandHandler = async (parsed, io, style) => {
  const title = stringFlag(parsed, 'title', 't') || 'Agora';
  const message = parsed.args.join(' ');
  const sound = Boolean(parsed.flags.sound);
  const platform = process.platform;

  if (!message) {
    return usageError(io, 'notify requires a message.\nUsage: agora notify <message> [--title "Title"] [--sound]');
  }

  if (parsed.flags.json) {
    writeJson(io.stdout, { platform, title, message, sound });
    return 0;
  }

  try {
    if (platform === 'darwin') {
      notifyDarwin(title, message, sound);
    } else if (platform === 'linux') {
      notifyLinux(title, message, sound);
    } else if (platform === 'win32') {
      notifyWindows(title, message, sound);
    } else {
      writeLine(io.stderr, `Desktop notifications not supported on ${platform}`);
      writeLine(io.stderr, `Message: ${title}: ${message}`);
      return 1;
    }
    writeLine(io.stdout, style.dim(`Notification sent: ${title}`));
  } catch (err: any) {
    return usageError(io, err.message || 'Failed to send notification');
  }

  return 0;
};
