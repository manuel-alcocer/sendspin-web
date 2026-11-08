# sendspin-web

The [Sendspin CLI](https://github.com/Sendspin/sendspin-cli) terminal UI, as an
installable web app (PWA). It is a Sendspin client built on
[`@sendspin/sendspin-js`](https://github.com/Sendspin/sendspin-js):

- **Audio on this device** (default): joins as a Sendspin player and plays the
  synchronized stream through the browser, like the CLI does through the sound
  card.
- **Remote only**: joins as controller + metadata only, without audio output,
  to see and control what a group is playing.

Switch between both with <kbd>a</kbd>. Everything else uses the CLI's keys,
and every key hint on screen can be tapped:

| Key | Action |
| --- | --- |
| <kbd>←</kbd> / <kbd>→</kbd> | previous / next track |
| <kbd>space</kbd> | play / pause |
| <kbd>g</kbd> | change group |
| <kbd>↑</kbd> / <kbd>↓</kbd> | player volume ±5 |
| <kbd>m</kbd> | mute player |
| <kbd>[</kbd> / <kbd>]</kbd> | group volume ±5 |
| <kbd>M</kbd> | mute group |
| <kbd>r</kbd> | cycle repeat (off → all → one) |
| <kbd>x</kbd> | toggle shuffle |
| <kbd>,</kbd> / <kbd>.</kbd> | output delay −10 / +10 ms |
| <kbd>s</kbd> | change server |
| <kbd>a</kbd> | audio on this device / remote only |
| <kbd>q</kbd> | quit (disconnect) |

Tapping the progress bar seeks. Lock-screen and notification controls work
through the Media Session API.

## Differences from the CLI

- **No mDNS discovery**: browsers can not browse mDNS. The server list starts
  with `/sendspin` on the app's own host, and more servers can be added by URL.
- **wss:// on HTTPS**: an installed PWA is served over HTTPS, and an HTTPS page
  may only open `wss://` sockets. Put the Sendspin server's `/sendspin`
  endpoint behind the same reverse proxy as the app (see below).
- Starting audio needs a tap or key press (browser autoplay rules); remote-only
  mode connects on its own.

## Deployment

`npm run build` writes the static app to `dist/`. Serve it over HTTPS and route
`/sendspin` on the same host to the Sendspin server (Music Assistant listens on
port 8927), with WebSocket upgrades allowed. The included `Dockerfile` serves
`dist/` with nginx on port 8080:

```sh
npm ci
npm run build
docker buildx build --platform linux/amd64,linux/arm64 -t <registry>/sendspin-web:<version> --push .
```

## Development

```sh
npm install
npm run dev
```

During development, add the server's plain `ws://<host>:8927/sendspin` URL with
<kbd>s</kbd> (allowed from `http://localhost`).

### Patch to sendspin-js

`sendspin-js` always advertises the player role. `patches/` adds a
`playerRole: false` option so the remote-only mode joins without it; it is
applied on `npm install` (`postinstall`) and is pinned to 6.0.0.

## License

Apache-2.0
