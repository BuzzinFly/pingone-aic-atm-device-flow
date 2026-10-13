# Mock bank ATM – device code sign-in (PingOne AIC POC)

An ATM screen that signs the customer in with the **OAuth 2.0 Device Authorization Grant (RFC 8628)**.
The ATM shows a QR code and a user code; the phone opens the tenant's **default hosted device page**
(`/am/oauth2/realms/root/realms/<realm>/device/user`), authenticates with whatever journey the realm uses,
and the ATM picks up the token by polling.

```
ATM browser ──► Node proxy ──► AIC  POST /device/code        (QR = verification_uri_complete)
ATM browser ──► Node proxy ──► AIC  POST /access_token       (poll every `interval`s; handles slow_down)
ATM browser ──► Node proxy ──► AIC  GET  /userinfo           (greeting)
ATM browser ──► Node proxy ──► AIC  POST /token/revoke       (End session)
Phone ────────────────────────► AIC  /device/user?user_code=…  (hosted login, no SDK app needed)
```
The proxy is the same pattern the Smart TV demo uses (`start` / `poll` / `user-info`); it avoids needing CORS on the tenant.

## Run
```
npm start                      # http://localhost:8081  (Node 18+, no dependencies to install)
docker build -t atm-poc . && docker run -p 8081:8081 atm-poc
```
Optional env: `PORT`, `ALLOWED_HOSTS=openam-xxx.forgeblocks.com` (lock the proxy to your tenant – recommended in the cloud),
`CONFIG_FILE` (defaults JSON, see `config.default.json`).

## Tenant setup (one OAuth 2.0 client)
Create a **public** OAuth 2.0 client in the realm, e.g. `atm-device`:
* Grant types: **Device Code** (Authorization Code not needed)
* Token endpoint auth method: **none** · Scopes: `openid profile email`
* Realm's OAuth 2.0 provider: **Device Code grant enabled**; leave *Verification URL* at the default so the phone lands on the hosted page.

## POC controls (⚙ top-right, or Alt+Shift+C)
Theme (Generic / Regional bank, Alt+Shift+T) · language · bank display name · tenant URL · realm · client ID · scopes ·
journey/service · acr_values · QR content · idle timeout · show manual code · revoke token on logout.
Settings persist in the browser (`localStorage`); Export/Import moves them between machines, and `config.default.json`
sets the defaults served to any fresh browser (handy for the cloud deployment). URL overrides: `?theme=regional&lang=en&tenant=https://…`.
**Alt+Shift+I** opens the inspector: every proxy call, decoded access-token claims, userinfo and the QR target.

## Things to verify against your tenant
* **Journey / service**: appended to the QR URL as `&service=`. Whether the hosted `/device/user` page honours it depends on the
  AM version, so test it; leaving it empty uses the realm's default journey (what you asked for).
* **Polling**: AM answers `slow_down` if polled at exactly `interval`, so the app polls at interval + 0.25 s and adds 5 s on every `slow_down`.
* **Theming** follows the previous app: MeridianBank (`bank`) and Caja Vega Verde (`regional`) names, logos and hero copy from the landing-page screenshots; Poppins, pill buttons, card style, hidden dot + left drawer, bottom inspector (also via the "Flow inspector" button). The regional green was re-sampled from the screenshot because it is more muted than the green in `app.css`.
* **Language** (ES/EN) applies to every ATM screen and re-renders live when changed (header button or POC controls). It is also sent to the tenant as `ui_locales` on the device
  authorization request and as `locale` / `ui_locales` on the QR URL, so the phone's hosted pages *can* follow it. Whether the hosted `/device/user` page honours those hints depends on
  the AIC version and the realm's localization; if it follows the phone's language instead, that is a tenant-side setting.
