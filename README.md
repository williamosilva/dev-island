English | [Português](README.pt-BR.md)

# Dev Island

Dev Island puts the scripts from your Node.js project in a small floating bar
over VS Code. Click a script, follow the output and keep working.

![Dev Island running a project script and showing the output in the terminal inside the bar](docs/images/dev-island-demo.gif)

It reads the `scripts` from your `package.json` and turns each one into a
button. When you switch to another project in another VS Code window, the bar
follows you and shows that project's scripts instead.

It is a standalone Electron app, not a VS Code extension.

I built Dev Island out of a little laziness. I was tired of typing the same npm
scripts and switching between terminals just to run dev, build or test. The
idea is simple: keep those scripts one click away and make this part of the day
a little faster.

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

Keep the folder somewhere stable. Setup records its absolute path, so if you
move or rename it later, run `setup` again.

## How to use

Run the setup once, from the Dev Island folder:

```bash
node bin/dev-island.js setup
```

Setup is done only once. After that, Dev Island works across your Node.js
projects. Open a project in VS Code, start an integrated PowerShell terminal,
and the Island loads that project's scripts.

So the whole flow is:

1. clone or download Dev Island;
2. `npm ci`;
3. `npm run build`;
4. `node bin/dev-island.js setup`, once;
5. leave the folder where it is;
6. open any Node.js project in VS Code;
7. open an integrated PowerShell terminal;
8. click the scripts on the Island.

You don't run `setup` in every project, and there is nothing to install
globally — Dev Island is not published to npm, and the `dev-island` command is
not added to your PATH. Whenever you need the CLI, call it through
`node bin/dev-island.js` from the Dev Island folder.

Clicking a script opens a terminal inside the bar, where you can watch the
output and stop or restart the process.

![A script running with its terminal open inside the bar](docs/images/dev-island-running-script.png)

When there are more scripts than fit, the extra ones go into `More (N)`.

![The More panel listing the scripts that did not fit](docs/images/dev-island-more-scripts.png)

You can also drag the buttons around to reorder them, and the order sticks.

If a project ever needs a manual sync, go to its folder and point at the CLI
with its full path:

```bash
cd C:\dev\my-app
node C:\tools\dev-island\bin\dev-island.js init
```

## Your own buttons

The `+` button adds a command that is not in your `package.json`. It asks for
two things — a **Name** (the label) and a **Script** (the command to run) — so
you can keep something like `npx prisma studio` or `docker compose up` one
click away. To remove one, open its terminal and hit **Delete**.

Dev Island keeps those buttons in a small file inside the project:

```
<your-project>/.dev-island/buttons.json
```

It holds the whole bar — the scripts found in `package.json`, the ones you
added by hand, and the order you dragged them into:

```json
{
  "buttons": [
    { "name": "Dev", "script": "npm run dev" },
    { "name": "Studio", "script": "npx prisma studio" }
  ]
}
```

It is plain JSON, so you can edit it by hand. Commit it if the buttons make
sense for the whole team, or add `.dev-island/` to that project's `.gitignore`
if they are just yours.

Your theme, the window position and its size are not stored there — those are
yours, not the project's, so they live in `%APPDATA%\dev-island` instead.

## Themes

The sun/moon button switches between the two themes, and your choice is
remembered.

| Dark | Light |
| --- | --- |
| ![Compact bar, dark theme](docs/images/dev-island-overview.png) | ![Compact bar, light theme](docs/images/dev-island-overview-light.png) |
| ![More panel, dark theme](docs/images/dev-island-more-scripts.png) | ![More panel, light theme](docs/images/dev-island-more-scripts-light.png) |

The terminal follows the theme as well:

![A script running with its terminal open, light theme](docs/images/dev-island-running-script-light.png)

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
