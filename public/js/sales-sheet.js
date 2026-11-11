// Live "Total" (distributor price x qty) in the entry / edit row.
(function () {
  function num(v) { var n = parseFloat(String(v).replace(/,/g, '')); return isNaN(n) ? 0 : n; }
  function fmt(n) { return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  document.querySelectorAll('tr.entry').forEach(function (tr) {
    var price = tr.querySelector('[name=distributor_price]');
    var qty = tr.querySelector('[name=qty]');
    var out = tr.querySelector('.row-total');
    if (!price || !qty || !out) return;
    function update() { out.textContent = fmt(num(price.value) * num(qty.value)); }
    price.addEventListener('input', update);
    qty.addEventListener('input', update);
    update();
  });
})();