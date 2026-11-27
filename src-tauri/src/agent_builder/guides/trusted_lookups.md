- Read-only lookups on a trusted host need no approval. A lookup is an `http-request` with `method: get` (or
  `head`), no `body`, and a URL whose `https://host` part is written out; only its path and query may read
  `{{#…#}}` values. When that host is one of the agent's trusted hosts (listed below when there are any), the
  lookup runs without asking: do not put a `human-input` before it. Send API keys to it in `params`, `headers`
  or `authorization` (`{{#env.NAME#}}`), never in the URL path.
- When a lookup goes to a host that is not trusted yet, keep it a lookup and end your opening sentences with
  the line `Trust <host> for lookups`, e.g. `Trust api.open-meteo.com for lookups`. The app shows that line as
  a button; only the user can trust a host, and the lookup does not run until they do. You cannot trust a host
  yourself: hosts written into the document are ignored. Outside chatbots you may instead put a `human-input`
  before the lookup. Requests that change data (POST, PUT, PATCH, DELETE) always need a `human-input`, also
  on trusted hosts.
- Public sites (Wikipedia among them) refuse a request that does not say who is asking. Give every
  `http-request` to a public site the header `User-Agent: graphrt-desktop`, e.g.
  `headers: "User-Agent: graphrt-desktop\nAccept: application/json"`. A fixed header keeps a lookup a lookup.
