#!/usr/bin/env python3
"""
The local play server. `python3 -m http.server` with one header added.

That header matters more here than it looks. This game is ES modules loaded
straight off disk with no build step, and http.server sends `Last-Modified`
but no `Cache-Control` and no `ETag`. With nothing to go on a browser falls
back to HEURISTIC freshness -- roughly a tenth of the file's age -- so a module
that has sat still for a day is held for hours without so much as a
conditional request, while one edited a minute ago is re-fetched at once.

Edit some files and not others and the page loads a MIXTURE: fresh state.js
against a cached view.js, say, which renders the whole game twenty yards past
the goal line and looks for all the world like a coordinate bug. `no-store`
is what stops that -- every reload gets every module as it is on disk.
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import sys


class NoCacheHandler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        super().end_headers()

    def log_message(self, fmt, *args):
        # One line per request is noise while playing; errors still surface
        # through log_error, which does not go through here.
        pass


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    handler = partial(NoCacheHandler, directory='.')
    with ThreadingHTTPServer(('127.0.0.1', port), handler) as httpd:
        print(f'Football By Turn: http://localhost:{port}  (Ctrl-C to stop)')
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print()


if __name__ == '__main__':
    main()
