# Third-party viewer bridge

The beginning of public/engine.js contains the official @sketchfab/viewer-api 1.12.0 bridge, from https://github.com/sketchfab/viewer-api/blob/master/viewer-api.js, upstream blob d48f730e5532beb7502a249d032043c0979972e9. Upstream package.json declares the ISC licence and Sketchfab as author. The executable body is preserved; its source-map comment is omitted and an environment guard allows isolated tests to supply a mock. Our controllers follow the vendor body.

ISC licence notice (Sketchfab):

Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby granted, provided that the above copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

The car model is not included in this repository. It remains in the official Sketchfab viewer, separately attributed to Black Snow under the source model's CC Attribution terms. Model rights, trademarks and the bridge software licence are distinct.
