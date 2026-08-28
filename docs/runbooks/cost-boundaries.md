# Cost boundaries

QuotePlate launches with a hard no-billing boundary:

- **No payment method** is attached to a QuotePlate Netlify, Neon, Backblaze, GitHub, Google, or related provider project.
- **No paid overage** or usage-based fallback is enabled.
- **No auto-recharge** is enabled.
- **No automatic upgrade** is allowed in a workflow, provider setting, or application path.
- Any paid change requires the operator's **fresh explicit approval** recorded separately. This runbook is not that approval.

If a provider changes its terms or asks for billing details, stop before accepting. A free-limit breach pauses onboarding, deployment, backup, or availability; it never authorizes spending.

| Boundary | Warning | Stop / action |
| --- | --- | --- |
| Netlify Free credits | 60%, 75% | At 85%, pause onboarding and nonessential previews; keep hard stop and no recharge |
| Neon storage | 350 MB, 425 MB | At 450 MB, pause onboarding; do not upgrade |
| Neon compute or transfer | 70%, 75% | Reduce nonessential work or pause onboarding; do not enable paid capacity |
| B2 encrypted backups | 70% of 8 GiB | Script refuses an upload whose projected total reaches **8 GiB** |
| GitHub Actions | 60%, 75% of included allowance | Cancel nonessential/manual runs; spending limit stays zero |
| Auth and sharing | N/A | Google identity scopes only; no paid email, SMS, or WhatsApp API |

## Operator check before every production release

1. Verify every provider still says Free and cardless.
2. Verify Netlify credit hard-stop, no auto-recharge, and no paid add-on.
3. Verify Neon has no billing account, smallest compute, and five-minute scale-to-zero.
4. Verify B2 has no card, the bucket is private, account caps remain conservative, and encrypted storage is below the warning.
5. Verify GitHub Actions spending is zero and the deploy requires the protected environment reviewer.
6. Record the readings. If any check is uncertain, do not deploy.
