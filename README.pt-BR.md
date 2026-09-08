[English](README.md) | Português

# Dev Island

O Dev Island coloca os scripts do seu projeto Node.js numa pequena barra
flutuante sobre o VS Code. Você clica no script, acompanha a saída e continua
trabalhando.

Ele lê os `scripts` do seu `package.json` e transforma cada um num botão. Se
você trocar para outro projeto em outra janela do VS Code, a barra acompanha e
passa a mostrar os scripts daquele projeto.

É um aplicativo Electron independente, não uma extensão do VS Code.

![A barra do Dev Island com os scripts de um projeto Node.js](docs/images/dev-island-overview.png)

## Beta

O Dev Island ainda está em beta. Hoje ele é feito para projetos Node.js, e o
suporte oficial é só para pastas com `package.json`.

Python, Maven, Gradle e outros tipos de projeto ainda estão em teste. O código
já tenta reconhecê-los, mas pode falhar ou não encontrar nada — não conte com
isso ainda.

O foco atual é Windows com VS Code.

## Requisitos

- Windows
- VS Code, com o terminal PowerShell integrado
- Node.js — a versão mínima é a do campo `engines` do
  [package.json](package.json) (hoje Node 18)
- npm

## Instalação

O Dev Island é distribuído por este repositório. Você clona, instala as
dependências e compila uma vez:

```bash
git clone https://github.com/williamosilva/dev-island.git
cd dev-island
npm ci
npm run build
```

Sem Git? Use **Code → Download ZIP**, extraia a pasta, abra um terminal nela e
rode os mesmos `npm ci` e `npm run build`.

O build importa: o `dist/` não fica no repositório e é justamente o que a CLI
carrega. Rode `npm run build` de novo depois de cada `git pull`.

## Como usar

Rode a configuração inicial, uma única vez, dentro da pasta do Dev Island:

```bash
node bin/dev-island.js setup
```

Isso instala um pequeno hook no seu perfil do PowerShell e sobe o Dev Island em
segundo plano. A partir daí:

1. abra um projeto Node.js no VS Code;
2. abra um terminal PowerShell integrado nele;
3. a barra aparece no topo da janela com os seus scripts;
4. clique em um para executar.

Clicar num script abre um terminal dentro da própria barra, onde você acompanha
a saída e pode parar ou reiniciar o processo.

![Um script em execução com o terminal aberto dentro da barra](docs/images/dev-island-running-script.png)

Quando há mais scripts do que cabe na barra, os que sobram vão para o
`Mais (N)`.

![O painel Mais listando os scripts que não couberam na barra](docs/images/dev-island-more-scripts.png)

Normalmente você não precisa de mais nada. Se quiser forçar a sincronização de
um projeto, entre na pasta dele e chame a CLI pelo caminho completo:

```bash
cd C:\dev\meu-app
node C:\ferramentas\dev-island\bin\dev-island.js init
```

## Comandos principais

Todos rodam a partir da pasta do Dev Island, depois do build:

```bash
node bin/dev-island.js setup     # configuração inicial
node bin/dev-island.js start     # sobe em segundo plano
node bin/dev-island.js stop      # encerra
node bin/dev-island.js --help    # todos os comandos
```

Para desfazer o hook do PowerShell, rode
`node bin/dev-island.js remove-shell-integration`.

## Desenvolvimento

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

O `npm run dev` compila o lado Node, sobe o Vite e abre o Electron com recarga
automática da interface.

## Licença

MIT © William Oliveira Silva
