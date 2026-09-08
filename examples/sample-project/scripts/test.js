'use strict';

// A short task that exits successfully: use it to check the exit message.
const GREEN = '\u001b[32m';
const RESET = '\u001b[0m';

console.log('executando 3 testes de exemplo...');
for (let index = 1; index <= 3; index += 1) {
  console.log(`${GREEN}ok${RESET} teste ${index}`);
}
console.log('3 passaram, 0 falharam');
