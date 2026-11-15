# 2026-11-15: the contact form writes an email, for now

The old site has a contact form (name, phone, mail, message) sent by WordPress. Harry wants to keep a form. A static site has nothing to send it with.

**Decision.** The new form has name, phone (optional) and message. "Write the email" opens the visitor's own mail app with the message addressed to info@robins-coffee.ch and filled in. Nothing is sent by the site, so there is no server, no account, no spam filter and no stored personal data. The mail field of the old form is gone because the visitor's mail app supplies the sender.

**Why not a real sender now.** Every option needs something we do not have yet:

| Option | Needs |
|---|---|
| A route on the editor's login Worker | A Cloudflare account, and a way to send mail from it (Cloudflare's own mail sending needs the domain's DNS on Cloudflare) |
| A form service (Web3Forms, Formspree and the like) | An account in the bar's name and an access key; a third party reads every message |

Who controls the DNS, and so which of the two fits, is settled at the cut-over (milestone 9). The login Worker arrives with the editor (milestone 7).

**What changes then.** `contact-form.liquid` gets an endpoint from `site.yml`, an email field, a honeypot and a sent or failed message; the mail app path stays as the fallback when the endpoint is unset or down.

**Known weakness.** A visitor with no mail app set up (some desktop browsers) gets nothing from the button. The phone number, the address and Instagram sit right above the form.
