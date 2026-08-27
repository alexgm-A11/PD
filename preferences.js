const questionCount = document.querySelector('#quickCount');
const focus = document.querySelector('#focusSelect');
const level = document.querySelector('#levelSelect');
const format = document.querySelector('#formatSelect');
const labels = { intermediate: 'Intermedio', advanced: 'Avanzado', expert: 'Experto' };

questionCount.addEventListener('change', () => sessionStorage.setItem('medCount', questionCount.value));
focus.addEventListener('change', () => sessionStorage.setItem('medFocus', focus.value));
format.addEventListener('change', () => sessionStorage.setItem('medFormat', format.value));
level.addEventListener('change', () => {
  sessionStorage.setItem('medLevel', level.value);
  document.querySelector('#difficulty').textContent = labels[level.value];
});
sessionStorage.setItem('medCount', questionCount.value);

