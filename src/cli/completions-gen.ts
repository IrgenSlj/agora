import { COMMANDS } from './commands-meta.js';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
) as { version: string };
const VERSION = pkg.version;

const IDS = [
  'mcp-filesystem', 'mcp-everything', 'mcp-github', 'mcp-gitlab', 'mcp-postgres',
  'mcp-redis', 'mcp-mongodb', 'mcp-elasticsearch', 'mcp-supabase', 'mcp-openai',
  'mcp-anthropic', 'mcp-replicate', 'mcp-huggingface', 'mcp-sequential-thinking',
  'mcp-memory', 'mcp-context7', 'mcp-brave-search', 'mcp-tavily', 'mcp-exa',
  'mcp-perplexity', 'mcp-firecrawl', 'mcp-google-maps', 'mcp-puppeteer',
  'mcp-playwright', 'mcp-playwright-ea', 'mcp-browsermcp', 'mcp-linear', 'mcp-jira',
  'mcp-asana', 'mcp-obsidian', 'mcp-confluence', 'mcp-sonarqube', 'mcp-snyk',
  'mcp-aws', 'mcp-vercel', 'mcp-netlify', 'mcp-discord', 'mcp-email', 'mcp-slack',
  'mcp-notion', 'mcp-gdrive', 'mcp-figma', 'mcp-magic', 'mcp-docker', 'mcp-sqlite',
  'mcp-pinecone', 'mcp-qdrant', 'mcp-chromadb', 'mcp-neo4j', 'mcp-cloudflare',
  'mcp-kubernetes', 'mcp-heroku', 'mcp-aws-kb', 'mcp-remote', 'mcp-datadog',
  'mcp-grafana', 'mcp-pagerduty', 'mcp-newrelic', 'mcp-sentry', 'mcp-stripe',
  'mcp-sequelize', 'prompt-code-review', 'prompt-api-design', 'prompt-refactor-plan',
  'prompt-debug-session', 'prompt-test-strategy', 'prompt-migration-plan',
  'wf-tdd-cycle', 'wf-security-audit', 'wf-api-design', 'wf-refactor-large',
  'wf-db-migration', 'wf-code-review-arch', 'wf-doc-generator', 'wf-postmortem',
  'wf-dependency-audit', 'wf-performance-audit', 'wf-ci-cd-review', 'wf-new-project'
];

const CATEGORIES = ['mcp', 'prompt', 'workflow', 'skill', 'all'];
const SORT_ORDERS = ['asc', 'desc'];
const SORT_BY = ['relevance', 'stars', 'installs', 'name', 'updated'];
const TYPES = ['package', 'workflow'];
const TYPES_EXT = ['discussion', 'reply', 'package', 'workflow'];
const LEVELS = ['beginner', 'intermediate', 'advanced'];
const NEWS_SOURCES = ['hn', 'reddit', 'gh', 'arxiv', 'rss'];
const BOARDS = ['mcp', 'agents', 'tools', 'workflows', 'show', 'ask', 'meta'];

const COMMAND_NAMES = COMMANDS.map((c) => c.name).concat(['help', 'completions', 'shell']);

function bash(): string {
  const a = [
    '# agora shell completion for bash (v' + VERSION + ')',
    '# Source: source <(agora completions bash)',
    '_agora_completions() {',
    '  local cur prev words cword',
    '  _init_completion || return',
    '',
    '  if [[ $cword -eq 1 ]]; then',
    '    COMPREPLY=($(compgen -W "' + COMMAND_NAMES.join(' ') + '" -- "$cur"))',
    '    return',
    '  fi',
    '',
    '  case $prev in',
    '    --category|-c) COMPREPLY=($(compgen -W "' + CATEGORIES.join(' ') + ' packages" -- "$cur")) ;;',
    '    --sort)       COMPREPLY=($(compgen -W "top new active" -- "$cur")) ;;',
    '    --order)      COMPREPLY=($(compgen -W "' + SORT_ORDERS.join(' ') + '" -- "$cur")) ;;',
    '    --sort-by)    COMPREPLY=($(compgen -W "' + SORT_BY.join(' ') + '" -- "$cur")) ;;',
    '    --source|-s)  COMPREPLY=($(compgen -W "' + NEWS_SOURCES.join(' ') + '" -- "$cur")) ;;',
    '    --board|-b)   COMPREPLY=($(compgen -W "' + BOARDS.join(' ') + '" -- "$cur")) ;;',
    '    --type|-t)    COMPREPLY=($(compgen -W "' + TYPES_EXT.join(' ') + '" -- "$cur")) ;;',
    '    --level)      COMPREPLY=($(compgen -W "' + LEVELS.join(' ') + '" -- "$cur")) ;;',
    '    --reason)     COMPREPLY=($(compgen -W "spam harassment undisclosed-llm malicious other" -- "$cur")) ;;',
    '    --model|-m)   COMPREPLY=($(compgen -W "deepseek-v4-flash-free nemotron-3-super-free gemini-2-flash-free" -- "$cur")) ;;',
    '    --limit|-n|--page|--per-page) COMPREPLY=($(compgen -W "5 10 20 50 100" -- "$cur")) ;;',
    '    --token|--api-url|--config|--data-dir) COMPREPLY=($(compgen -A file -- "$cur")) ;;',
    '  esac',
    '',
    '  case $1 in',
    '    browse|install|save|remove|similar|flag)',
    '      COMPREPLY+=($(compgen -W "' + IDS.join(' ') + '" -- "$cur"))',
    '      ;;',
    '  esac',
    '',
    '  if [[ $prev == --content-file || $prev == --prompt-file || $prev == --config ]]; then',
    '    COMPREPLY=($(compgen -A file -- "$cur"))',
    '  fi',
    '}',
    'complete -F _agora_completions agora',
    ''
  ];
  return a.join('\n');
}

function zsh(): string {
  const cmdDefs = COMMANDS.map(
    (c) => '  "' + c.name + ':' + c.summary + '"'
  ).concat([
    '  "completions:Generate shell completion scripts"',
    '  "shell:Start the interactive Agora shell"'
  ]).join('\n');

  const ids = IDS.map((id) => '"' + id + '"').join(' ');

  const a = [
    '#compdef agora',
    '# source: agora completions zsh > /usr/local/share/zsh/site-functions/_agora',
    'local -a _1st_arguments',
    '_1st_arguments=(',
    cmdDefs,
    ')',
    '',
    'local -a _ids',
    '_ids=(' + ids + ')',
    '',
    '_arguments \\',
    '  \'-h[Show help]\' \\',
    '  \'--help[Show help]\' \\',
    '  \'-v[Show version]\' \\',
    '  \'--version[Show version]\' \\',
    '  \'--json[Output as JSON]\' \\',
    '  \'*:: :->subcmd\' \\',
    '  && return 0',
    '',
    'case $state in',
    '  subcmd)',
    '    case $words[1] in',
    '      search)',
    '        _arguments \\',
    '          \'--category=[Category]:category:(' + CATEGORIES.join(' ') + ')\' \\',
    '          \'--sort-by=[Sort field]:sort:(' + SORT_BY.join(' ') + ')\' \\',
    '          \'--order=[Sort order]:order:(' + SORT_ORDERS.join(' ') + ')\' \\',
    '          \'--limit=[Max results]:number\' \\',
    '          \'--page=[Page number]:number\' \\',
    '          \'--per-page=[Items per page]:number\' \\',
    '          \'--table[Table view]\' \\',
    '          \'--json[JSON output]\'',
    '        ;;',
    '      browse|install)',
    '        _arguments \\',
    '          \'--type=[Item type]:type:(package workflow)\' \\',
    '          \'--json[JSON output]\' \\',
    '          ":id:(' + ids + ')"',
    '        ;;',
    '      completions)',
    '        _arguments \\',
    '          ":shell:(bash zsh fish)"',
    '        ;;',
    '      init)',
    '        _arguments \\',
    '          \'--dry-run[Preview only]\' \\',
    '          \'--json[JSON output]\' \\',
    '          \'--mcp[Register MCP server]\'',
    '        ;;',
    '      trending)',
    '        _arguments \\',
    '          \'--category=[Category]:category:(packages workflows all)\' \\',
    '          \'--limit=[Max results]:number\' \\',
    '          \'--sort-by=[Sort field]:sort:(' + SORT_BY.join(' ') + ')\' \\',
    '          \'--order=[Sort order]:order:(' + SORT_ORDERS.join(' ') + ')\' \\',
    '          \'--table[Table view]\' \\',
    '          \'--json[JSON output]\'',
    '        ;;',
    '      *) _arguments \'*: :_files\' ;;',
    '    esac',
    '    ;;',
    'esac',
    ''
  ];
  return a.join('\n');
}

function fish(): string {
  const cmdNames = COMMANDS.map((c) => c.name).concat(['completions', 'shell']).join(' ');

  const a = [
    '# agora shell completion for fish (v' + VERSION + ')',
    '# source: agora completions fish > ~/.config/fish/completions/agora.fish',
    'function __agora_list_ids',
    '    set -l ids ' + IDS.join(' '),
    '    for id in $ids',
    '        echo $id',
    '    end',
    'end',
    '',
    'complete -c agora -f',
    '',
    'complete -c agora -n "__fish_use_subcommand" -a "' + cmdNames + '" -f',
    '',
    'complete -c agora -s h -l help -d "Show help"',
    'complete -c agora -s v -l version -d "Show version"',
    'complete -c agora -l json -d "JSON output"',
    '',
    'complete -c agora -n "__fish_seen_subcommand_from search" -l category -d "Category" -xa "' + CATEGORIES.join(' ') + ' packages"',
    'complete -c agora -n "__fish_seen_subcommand_from search" -l sort-by -d "Sort field" -xa "' + SORT_BY.join(' ') + '"',
    'complete -c agora -n "__fish_seen_subcommand_from search" -l order -d "Sort order" -xa "' + SORT_ORDERS.join(' ') + '"',
    'complete -c agora -n "__fish_seen_subcommand_from search" -l limit -d "Max results" -xa "5 10 20 50"',
    'complete -c agora -n "__fish_seen_subcommand_from search" -l page -d "Page number" -xa "1 2 3 4 5"',
    'complete -c agora -n "__fish_seen_subcommand_from search" -l table -d "Table view"',
    'complete -c agora -n "__fish_seen_subcommand_from browse install save remove" -l type -d "Item type" -xa "' + TYPES.join(' ') + '"',
    'complete -c agora -n "__fish_seen_subcommand_from browse install" -xa "(__agora_list_ids)"',
    'complete -c agora -n "__fish_seen_subcommand_from completions" -xa "bash zsh fish"',
    'complete -c agora -n "__fish_seen_subcommand_from trending" -l category -d "Category" -xa "packages workflows all"',
    'complete -c agora -n "__fish_seen_subcommand_from init" -l dry-run -d "Preview only"',
    'complete -c agora -n "__fish_seen_subcommand_from init" -l mcp -d "Register MCP server"',
    'complete -c agora -n "__fish_seen_subcommand_from community" -l sort -d "Sort order" -xa "top new active"',
    'complete -c agora -n "__fish_seen_subcommand_from news" -l source -d "Source" -xa "' + NEWS_SOURCES.join(' ') + '"',
    'complete -c agora -n "__fish_seen_subcommand_from config" -l config -r -d "Config path"',
    ''
  ];
  return a.join('\n');
}

export function generateCompletions(shell: string): string {
  if (shell === 'bash' || shell === 'zsh' || shell === 'fish') {
    const generators: Record<string, () => string> = { bash, zsh, fish };
    return generators[shell]();
  }
  return 'Unknown shell: ' + shell + '. Supported: bash, zsh, fish';
}
