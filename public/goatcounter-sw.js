// Never cache or answer requests to GoatCounter. Let the browser send them.
self.addEventListener('fetch', function (event) {
  try {
    var host = new URL(event.request.url).hostname;
    if (host === 'goatcounter.com' || host.endsWith('.goatcounter.com')) event.stopImmediatePropagation();
  } catch (err) {}
});
