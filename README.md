English | [Português](README.pt-BR.md)

# Dev Island

Dev Island puts the scripts from your Node.js project in a small floating bar
over VS Code. Click a script, follow the output and keep working.

It reads the `scripts` from your `package.json` and turns each one into a
button. When you switch to another project in another VS Code window, the bar
follows you and shows that project's scripts instead.

It is a standalone Electron app, not a VS Code extension.

![The Dev Island bar showing the scripts of a Node.js project](docs/images/dev-island-overview.png)

## Beta status

Dev Island is still in beta. Right now, it is made for Node.js projects, and
support is official only for folders with a `package.json`.

Python, Maven, Gradle and other project types are still being tested. The code
already tries to detect them, but it can fail or find nothing — don't count on
it yet.

The focus today is Windows with VS Code.

## Requirements

- Windows
- VS Code, with its integrated PowerShell terminal
- Node.js — the minimum is the version in the `engines` field of
  [package.json](package.json) (today Node 18)
- npm

## Installation

Dev Island is distributed from this repository. You clone it, install the
dependencies and build it once:

```bash
git clone https://github.com/williamosilva/dev-island.git
cd dev-island
npm ci
npm run build
```

No Git? Use **Code → Download ZIP**, extract the folder, open it in a terminal
and run the same `npm ci` and `npm run build`.

The build matters: `dist/` is not in the repository, and it is what the CLI
loads. Run `npm run build` again after every `git pull`.

## How to use

Run the one-time setup from the Dev Island folder:

```bash
node bin/dev-island.js setup
```

That installs a small hook in your PowerShell profile and starts Dev Island in
the background. From then on:

1. open a Node.js project in VS Code;
2. open an integrated PowerShell terminal in it;
3. the bar appears at the top of the window with your scripts;
4. click one to run it.

Clicking a script opens a terminal inside the bar, where you can watch the
output and stop or restart the process.

![A script running with its terminal open inside the bar](docs/images/dev-island-running-script.png)

When there are more scripts than fit, the extra ones go into `Mais (N)`.

![The Mais panel listing the scripts that did not fit on the bar](docs/images/dev-island-more-scripts.png)

You normally never need anything else. If you want to force a project to sync,
go to its folder and point at the CLI with its full path:

```bash
cd C:\dev\my-app
node C:\tools\dev-island\bin\dev-island.js init
```

## Main commands

All of them run from the Dev Island folder, after the build:

```bash
node bin/dev-island.js setup     # one-time setup
node bin/dev-island.js start     # start it in the background
node bin/dev-island.js stop      # stop it
node bin/dev-island.js --help    # every command
```

To undo the PowerShell hook, run
`node bin/dev-island.js remove-shell-integration`.

## Development

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

`npm run dev` builds the Node side, starts Vite and opens Electron with hot
reload for the interface.

## License

MIT © William Oliveira Silva
