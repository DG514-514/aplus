'use strict';

// Print button on the signed agreement record (inline handlers are blocked by the CSP).
document.addEventListener('click', (e) => {
  if (e.target.closest('[data-print]')) window.print();
});
