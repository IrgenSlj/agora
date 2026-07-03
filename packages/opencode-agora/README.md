# opencode-agora

The **OpenCode plugin entry** for [Agora](https://github.com/IrgenSlj/agora) — the system
manager for your agentic stack.

This package is a one-line re-export of `agora-hub/opencode`. It exists only so that

```jsonc
// opencode.json
{ "plugin": ["opencode-agora"] }
```

keeps working unchanged: OpenCode loads plugins by npm package name and auto-installs them at
startup. All of the real code — and the `agora` CLI — live in the
[`agora-hub`](https://www.npmjs.com/package/agora-hub) package, which this one depends on.

## Want the CLI?

```bash
npm i -g agora-hub
agora
```

See the [main README](https://github.com/IrgenSlj/agora#readme) for what Agora does.

## License

[MIT](https://github.com/IrgenSlj/agora/blob/main/LICENSE) — © IrgenSlj.
