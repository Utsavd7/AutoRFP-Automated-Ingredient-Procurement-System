export const SUPPLIER_SEARCH_SANDBOX = 'allow-scripts allow-popups allow-popups-to-escape-sandbox';
export const SUPPLIER_SEARCH_TIMEOUT_MS = 20_000;

export function supplierSearchEngineId(value: string | undefined): string | null {
  const id = value?.trim();
  return id && id.length <= 100 && /^[A-Za-z0-9_-]{5,}(?::[A-Za-z0-9_-]+)?$/.test(id) ? id : null;
}

export function supplierSearchDocument(engineId: string, query: string): string | null {
  const id = supplierSearchEngineId(engineId);
  if (!id || !query.trim() || query.length > 1000) return null;
  // JSON alone does not escape HTML script terminators in user-entered searches.
  const scriptQuery = JSON.stringify(query).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const scriptUrl = `https://cse.google.com/cse.js?cx=${encodeURIComponent(id)}`;
  return `<!doctype html>
<html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer">
<style>body{margin:0;padding:8px;background:#fff;color:#101817;font:14px Arial,sans-serif}#error{line-height:1.5}</style>
</head><body><p id="error" role="status" hidden>Combined search could not load. Please use the website searches below.</p><div id="results"></div>
<script>
(function () {
  var finished = false;
  function report(status) { parent.postMessage({type:'quoteplate-supplier-search',status:status}, '*'); }
  function fail() {
    if (finished) return;
    finished = true;
    document.getElementById('error').hidden = false;
    report('failed');
  }
  var timer = setTimeout(fail, ${SUPPLIER_SEARCH_TIMEOUT_MS});
  window.__gcse = {
    parsetags: 'explicit',
    initializationCallback: function () {
      if (finished) return;
      try {
        google.search.cse.element.render({div:'results',tag:'searchresults-only',gname:'suppliers',attributes:{linkTarget:'_blank',autoSearchOnLoad:false,enableImageSearch:false,mobileLayout:'enabled',ivt:true}});
        google.search.cse.element.getElement('suppliers').execute(${scriptQuery});
      } catch (_) { fail(); }
    },
    searchCallbacks: {web:{rendered:function () {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      report('ready');
    }}}
  };
  var script = document.createElement('script');
  script.async = true;
  script.src = ${JSON.stringify(scriptUrl)};
  script.onerror = fail;
  document.head.appendChild(script);
})();
</script></body></html>`;
}
