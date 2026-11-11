import { COMMANDS } from './commands-meta.js';

const NAMES = [...COMMANDS.map((c) => c.name), 'help'].join(' ');

/** A completion script for the named shell, or an `Unknown shell` message. */
export function generateCompletions(shell: string): string {
  if (shell === 'bash') {
    return [
      '_agoracomplete() {',
      '  if [[ $COMP_CWORD -eq 1 ]]; then',
      `    COMPREPLY=($(compgen -W "${NAMES}" -- "\${COMP_WORDS[1]}"))`,
      '  fi',
      '}',
      'complete -F _agoracomplete agora'
    ].join('\n');
  }
  if (shell === 'zsh') {
    return ['#compdef agora', `_arguments '1:command:(${NAMES})'`].join('\n');
  }
  if (shell === 'fish') {
    return `complete -c agora -f -n '__fish_use_subcommand' -a '${NAMES}'`;
  }
  return `Unknown shell: ${shell}. Use bash, zsh or fish.`;
}
