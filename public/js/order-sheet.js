// Data-entry sheet behavior: price auto-fill, inline row add/remove, live totals.
// Prices shown here are for convenience only — the server snapshots prices itself.
(function () {
  var body = document.getElementById('lines');
  var tpl = document.getElementById('line-template');
  var addBtn = document.getElementById('add-row');
  var totalEl = document.getElementById('order-total');
  if (!body || !tpl) return;

  function fmt(cents) {
    var neg = cents < 0;
    var abs = Math.abs(cents);
    return (neg ? '-' : '') + Math.floor(abs / 100).toLocaleString('en-US') + '.' + String(abs % 100).padStart(2, '0');
  }

  function recalc() {
    var grand = 0;
    body.querySelectorAll('tr.line').forEach(function (row) {
      var cents = row.dataset.cents === '' ? null : Number(row.dataset.cents);
      var qty = parseInt(row.querySelector('.qty').value, 10);
      row.querySelector('.price').textContent = cents === null ? '' : fmt(cents);
      var cell = row.querySelector('.line-total');
      if (cents !== null && qty > 0) {
        cell.textContent = fmt(cents * qty);
        grand += cents * qty;
      } else {
        cell.textContent = '';
      }
    });
    totalEl.textContent = fmt(grand);
  }

  function addRow(focus) {
    var node = tpl.content.firstElementChild.cloneNode(true);
    body.appendChild(node);
    if (focus) node.querySelector('select').focus();
    recalc();
  }

  body.addEventListener('change', function (e) {
    if (e.target.tagName !== 'SELECT') return;
    var row = e.target.closest('tr.line');
    var opt = e.target.selectedOptions[0];
    row.dataset.cents = opt && opt.dataset.price !== undefined && opt.value !== '' ? opt.dataset.price : '';
    recalc();
  });

  body.addEventListener('input', function (e) {
    if (e.target.classList.contains('qty')) recalc();
  });

  body.addEventListener('click', function (e) {
    if (!e.target.classList.contains('remove-row')) return;
    var row = e.target.closest('tr.line');
    if (body.querySelectorAll('tr.line').length === 1) {
      row.querySelector('select').value = '';
      row.querySelector('.qty').value = '';
      row.dataset.cents = '';
    } else {
      row.remove();
    }
    recalc();
  });

  // Enter in the last quantity box adds a new row instead of submitting.
  body.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || !e.target.classList.contains('qty')) return;
    e.preventDefault();
    var rows = body.querySelectorAll('tr.line');
    var row = e.target.closest('tr.line');
    if (row === rows[rows.length - 1]) addRow(true);
    else row.nextElementSibling.querySelector('select').focus();
  });

  addBtn.addEventListener('click', function () { addRow(true); });
  recalc();
})();
