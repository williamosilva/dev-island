'use strict';

// A deliberately never-ending task: use it to check live output, Parar,
// Reiniciar and Limpar in the widget.
const GREEN = '\u001b[32m';
const CYAN = '\u001b[36m';
const RESET = '\u001b[0m';

let tick = 0;
console.log(`${CYAN}sample-project${RESET} dev server em execução. Ctrl+C para parar.`);

setInterval(() => {
  tick += 1;
  console.log(`${GREEN}[${new Date().toLocaleTimeString()}]${RESET} rebuild #${tick}`);
}, 1000);
