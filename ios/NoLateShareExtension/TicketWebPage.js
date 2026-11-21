// Safari runs this in the page being shared. Never fetch a ticket URL or return
// its path/query, cookies, form fields, HTML, or QR image to the extension.
// A smart ticket has two visual columns. DOM reading order alone cannot tell
// which station is above which time (CSS can even reorder the columns).
function smartTicketRegions(text) {
  if (!/스\s*마\s*트\s*티\s*켓/.test(text)) return [];
  var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  var range = document.createRange();
  var regions = [];
  var visited = 0;
  for (var node = walker.nextNode(); node; node = walker.nextNode()) {
    if (++visited > 2048) return [];
    var value = node.nodeValue.trim();
    var element = node.parentElement;
    if (!value || value.length > 100 || !text.includes(value) || !element ||
        element.closest('script, style, template, textarea, input, select, [hidden], [aria-hidden="true"]')) continue;
    if (element.checkVisibility && !element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
    var style = getComputedStyle(element);
    if (style.visibility !== 'visible' || style.opacity === '0') continue;
    range.selectNodeContents(node);
    var rects = range.getClientRects();
    if (rects.length !== 1) continue;
    var box = rects[0];
    if (box.width > 0 && box.height > 0) {
      if (regions.length === 256) return [];
      regions.push([value, box.left, box.top, box.width, box.height]);
    }
  }
  return regions;
}

// eslint-disable-next-line no-unused-vars -- Safari invokes this required global.
var ExtensionPreprocessingJS = {
  run: function (args) {
    var result = {};
    try {
      var host = window.location.hostname.toLowerCase().replace(/\.$/, '');
      var railway = ['korail.com', 'korail.go.kr', 'letskorail.com', 'srail.or.kr'].some(function (domain) {
        return host === domain || host.endsWith('.' + domain);
      });
      var bus = ['bustago.or.kr', 'kobus.co.kr'].some(function (domain) {
        return host === domain || host.endsWith('.' + domain);
      }) || ['intercitybus.tmoney.co.kr', 'intercitybuse.tmoney.co.kr', 'intercitybusc.tmoney.co.kr',
        'intercitybusj.tmoney.co.kr', 'txbus.t-money.co.kr'].includes(host);
      if (window.location.protocol === 'https:' && !window.location.username && !window.location.password &&
          (!window.location.port || window.location.port === '443') && (railway || bus)) {
        var text = document.body ? document.body.innerText : '';
        result = { version: 1, origin: 'https://' + host };
        // Return an explicit error rather than a truncated, misleading ticket.
        if (text.length > 32000) result.tooLarge = true;
        else {
          result.text = text;
          var regions = railway ? smartTicketRegions(text) : [];
          if (regions.length) result.regions = regions;
        }
      }
    } catch (_) {
      // URL sharing still works when a host does not expose its page contents.
    }
    args.completionFunction(result);
  }
};
