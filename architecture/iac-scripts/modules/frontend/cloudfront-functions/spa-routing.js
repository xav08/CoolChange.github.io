// SPA routing, iteration-aware. Handles two things the S3 origin can't:
//   1. Root app routes (e.g. /methodology) -> serve /index.html
//   2. Frozen iteration routes (e.g. /iteration1/methodology) -> serve
//      that iteration's own /iteration1/index.html, not the root one.
// Real asset requests (anything with a file extension, e.g. main.abc123.js)
// are left untouched either way, since those objects genuinely exist at
// that S3 key. Runs at the edge before origin lookup, so unlike the
// custom_error_response fallback below, it can tell iteration paths apart
// from root paths instead of sending everything to the same index.html.
function handler(event) {
    var request = event.request;
    var uri = request.uri;
    var iterationPrefixes = ['/iteration1/', '/iteration2/', '/iteration3/'];
    var matchedPrefix = null;

    for (var i = 0; i < iterationPrefixes.length; i++) {
        var bare = iterationPrefixes[i].slice(0, -1); // e.g. '/iteration1'
        if (uri === bare || uri.indexOf(iterationPrefixes[i]) === 0) {
            matchedPrefix = iterationPrefixes[i];
            break;
        }
    }

    var lastSegment = uri.substring(uri.lastIndexOf('/') + 1);
    var looksLikeAppRoute = lastSegment.indexOf('.') === -1;

    if (matchedPrefix && looksLikeAppRoute) {
        request.uri = matchedPrefix + 'index.html';
    } else if (!matchedPrefix && looksLikeAppRoute) {
        request.uri = '/index.html';
    }

    return request;
}