"use strict";

// On every response. frame-ancestors (and X-Frame-Options for older browsers) stop another
// site showing the app in a hidden frame and steering clicks onto it, such as an admin's
// Delete. The referrer policy keeps a reset token in the address out of requests to other
// sites. No script-src yet: the page's config is an inline script, and the client sets
// inline styles and handlers in many places, so a full policy is its own change.
function securityHeaders(production) {
  return function(req, res, next) {
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    // Only behind HTTPS; on localhost it would make the browser refuse plain http for a year.
    if (production) res.setHeader("Strict-Transport-Security", "max-age=15552000");
    next();
  };
}

module.exports = { securityHeaders };
