# Getting a real Tailscale cert (optional — `tls internal` works fine on the tailnet)

The default `infra/caddy/Caddyfile` uses `tls internal` (Caddy's local CA). That
is a perfectly good choice inside a tailnet: clients are all your own devices,
and `tailscale cert` isn't required.

If you want browsers on the tailnet to trust the cert without installing the
local CA, use Tailscale's cert-issuance feature instead:

1. On the Pi, enable HTTPS / MagicDNS in the Tailscale admin console.
2. Run `sudo tailscale cert <pi>.<tailnet>.ts.net` to materialize
   `.crt`/`.key` files.
3. Mount them into the `caddy` container (e.g. `/etc/caddy/ts/`) and swap
   the `tls internal` line in `Caddyfile` for:

   ```
   tls /etc/caddy/ts/<host>.crt /etc/caddy/ts/<host>.key
   ```

4. Add a systemd timer (or cron) that re-runs `tailscale cert` every ~60
   days and `docker compose kill -s HUP caddy` to reload.

The Caddyfile is deliberately small so this swap is a two-line change.
