// Keeps the "N waiting" badges current while the dashboard stays open.
(function () {
  var wrap = document.getElementById('store-cards');
  if (!wrap) return;
  var month = wrap.getAttribute('data-month');

  function refresh() {
    fetch('/api/waiting?month=' + encodeURIComponent(month), { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data) return;
        document.querySelectorAll('[data-badge-store]').forEach(function (el) {
          var n = data.stores[el.getAttribute('data-badge-store')] || 0;
          el.textContent = n + ' waiting';
          el.hidden = n === 0;
        });
      })
      .catch(function () { /* offline blip: try again next tick */ });
  }

  setInterval(refresh, 20000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refresh(); });
})();
