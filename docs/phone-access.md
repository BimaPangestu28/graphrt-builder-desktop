# Phone access

Follow the agents that run on your computer from your phone: their runs, what each one
did, and the requests that wait for you (an approval, a question, a tool an agent asks to
use). Answer them with a tap, and get a notification when a run fails or waits.

The phone opens the same monitoring page as an agent you put online (graphrt's
`/monitor/`). Your computer serves it itself: there is no account and no server of ours in
between.

## Turning it on

**Settings > Phone access > Let my phones connect.** It is off until you turn it on.

1. Choose where your phone is (below).
2. Press **Pair a phone**, give it a name and scan the code with the phone's camera.
3. The page opens already paired. Add it to the home screen to keep it:
   - Android (Chrome, Edge): menu, **Add to Home screen** or **Install app**.
   - iPhone and iPad: open it in Safari, **Share**, **Add to Home Screen**.
4. For notifications, open **Settings** in the phone page and turn them on (needs HTTPS,
   see below).

The computer has to be on and awake for the phone to see anything. Paired phones stay
paired when the computer sleeps, restarts or the app updates.

## Where your phone is

| Choice | Works | HTTPS and notifications | Needs |
| --- | --- | --- | --- |
| **On the same Wi-Fi** | At home or in the office | No | Nothing |
| **Anywhere, with Tailscale** | Wherever the phone has internet | Yes, with HTTPS Certificates on | Tailscale on the computer and the phone, same account |
| **Anywhere, with my own tunnel** | Wherever the phone has internet | Yes | A tunnel you run, such as Cloudflare Tunnel |

### On the same Wi-Fi

The page is served on the computer's address on your network (for example
`http://192.168.1.21:47613`), and only there: not on other networks of the computer
(Docker, VPNs, Tailscale). When the computer gets a new address (after waking up on
another network), the page moves with it within half a minute.

It is plain HTTP, so use it on a network you trust. Browsers allow notifications only on
HTTPS pages, so there are none in this mode.

### Anywhere, with Tailscale

[Tailscale](https://tailscale.com) connects your own devices in a private network (a
"tailnet"). It is free for personal use. Install it on the computer and on the phone and
sign in with the same account.

With **HTTPS Certificates** on for your tailnet, the app asks Tailscale to serve the page
at `https://<computer>.<tailnet>.ts.net:47613` with a real certificate (`tailscale serve`).
Tailscale forwards to the app on `127.0.0.1` only. Phones get notifications.

To turn HTTPS on (once):

1. In the [Tailscale admin console](https://login.tailscale.com/admin/dns), open **DNS**,
   make sure **MagicDNS** is on, and press **Enable HTTPS**. Your computer's name then
   appears in the public Certificate Transparency logs, as for any HTTPS certificate.
2. On Linux, let your user change what Tailscale serves:
   `sudo tailscale set --operator=$USER`. macOS and Windows need nothing.
3. In the app, turn Phone access off and on.

Without HTTPS the page is served on the computer's tailnet address
(`http://100.x.y.z:47613`). Tailscale still encrypts the traffic, but browsers count it as
insecure, so there are no notifications. The settings screen says which one you have.

When you turn Phone access off, the app removes what it asked Tailscale to serve.

### Anywhere, with my own tunnel (Cloudflare Tunnel)

The app serves on `http://127.0.0.1:47613`, reachable from this computer only. A tunnel
makes it reachable under an HTTPS address of yours. Enter that address in the app, for
example `https://agents.example.com`; requests for any other name are refused.

With [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
(free, needs a Cloudflare account and a domain on Cloudflare):

```sh
cloudflared tunnel login
cloudflared tunnel create graphrt-phone
cloudflared tunnel route dns graphrt-phone agents.example.com
cloudflared tunnel run --url http://127.0.0.1:47613 graphrt-phone
```

Keep `cloudflared` running while you want phone access, or install it as a service
(`cloudflared service install`). A quick tunnel (`cloudflared tunnel --url
http://127.0.0.1:47613`) works too, but its `trycloudflare.com` address changes every time
it starts, and paired phones have to be paired again.

Anything that forwards HTTPS to `http://127.0.0.1:47613` works the same way (ngrok, a
reverse proxy on a server you rent).

## What a phone can do

A paired phone gets a **device token** that:

- lists runs and reads what each did, and lists and answers the requests that wait for a
  person;
- cannot start, stop or change an agent, read your keys, connections or knowledge, or pair
  another phone;
- can be removed in **Settings > Phone access** at any time: it stops working at once.

Values that look like secrets (passwords, tokens, API keys) are hidden in what a phone
receives, as on your own approval cards. Test runs of the builder are not shown.

## Security

- **One network at a time.** The server listens on the chosen network only: your Wi-Fi
  address, the tailnet address, or `127.0.0.1` behind Tailscale HTTPS or a tunnel.
- **Names and origins.** Requests must name the address the page is served under. A web
  page elsewhere that points its own name at your computer (DNS rebinding) is refused, and
  so are requests other sites make from a browser.
- **Pairing codes** work once, for 10 minutes, and are not the phone's key. Hiding a code
  ends it. Wrong codes and wrong tokens are slowed down (a few attempts a minute).
- **Stored safely.** Tokens are kept as SHA-256 hashes. Devices, push subscriptions, the
  notification key and the activity log are in the app's data folder, `phone-access/`,
  readable by your user only.
- **Activity.** The settings screen lists the newest pairings, removals, answers from
  phones and refused pairing codes.

## Notifications

When a run fails or waits for you, the computer sends a Web Push notification to every
phone that turned them on: the agent's name and the question or what went wrong, in one
line. The message is encrypted for the phone; the push service of the phone's browser
(Google, Apple, Mozilla) relays it without being able to read it. No account is needed.

iPhone and iPad (iOS 16.4 or newer) notify only for the page added to the Home Screen and
opened from there.

## Not included

There is no relay or cloud service of graphrt in between, on purpose. We looked at
[iroh](https://iroh.computer) (peer-to-peer connections with a relay for the cases where
devices cannot reach each other): a phone's browser cannot use it without a native app,
and the public relays are meant for development, so a production setup would need a relay
server someone pays for. Tailscale and tunnels already reach a computer from anywhere
without that.
