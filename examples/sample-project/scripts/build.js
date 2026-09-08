'use strict';

// A task with a couple of seconds of work, to watch output arrive in real time.
const YELLOW = '\u001b[33m';
const RESET = '\u001b[0m';

const steps = ['limpando', 'compilando', 'empacotando', 'concluído'];

let index = 0;
const timer = setInterval(() => {
  console.log(`${YELLOW}${steps[index]}${RESET}`);
  index += 1;
  if (index === steps.length) clearInterval(timer);
}, 600);
