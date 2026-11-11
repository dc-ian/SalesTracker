// Replaces inline onsubmit/onchange handlers so the CSP can forbid inline scripts.
//   <form data-confirm="Are you sure?">  -> confirm dialog before submit
//   <input data-autosubmit>              -> submits its form on change
document.addEventListener('submit', function (e) {
  var msg = e.target.getAttribute && e.target.getAttribute('data-confirm');
  if (msg && !window.confirm(msg)) e.preventDefault();
});

document.addEventListener('change', function (e) {
  if (e.target.hasAttribute && e.target.hasAttribute('data-autosubmit') && e.target.form) {
    e.target.form.submit();
  }
});
