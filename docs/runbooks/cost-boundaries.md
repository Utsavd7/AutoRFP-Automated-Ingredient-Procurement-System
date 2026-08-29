# Cost boundaries

QuotePlate launches with a hard no-billing boundary:

- **No payment method** is attached to the QuotePlate Vercel, Neon, GitHub, Google, or optional backup provider projects.
- **No paid overage** or usage-based fallback is enabled.
- **No auto-recharge** is enabled.
- **No automatic upgrade** is allowed.
- No workflow or application path can buy capacity.
- Any paid change requires the operator's **fresh explicit approval**. This runbook is not that approval.

If a provider changes its terms or asks for billing details, stop before accepting. A free-limit breach pauses onboarding, deployment, backup, or availability; it never authorizes spending.

| Boundary | Warning | Stop / action |
| --- | --- | --- |
| Vercel Hobby usage | 60%, 75% of an included limit | At 85%, pause nonessential previews and new onboarding; do not upgrade |
| Neon storage | 350 MB, 425 MB | At 450 MB, pause onboarding; do not upgrade |
| Neon compute or transfer | 70%, 75% | Reduce nonessential work or pause onboarding; do not enable paid capacity |
| Optional encrypted backups | 70% of the provider's free storage | The current script stops before 8 GiB; never attach a card automatically |
| GitHub Actions | 60%, 75% of included allowance | Cancel nonessential/manual runs; spending limit stays zero |
| Auth and sharing | N/A | Google identity scopes only; no paid email, SMS, or WhatsApp API |

## Operator check before every production release

1. Verify every provider still says Free or Hobby and has no payment method.
2. Verify Vercel remains Hobby with no paid add-on or billable integration.
3. Verify Neon remains Free with the smallest autoscaling range and scale-to-zero.
4. Verify any optional backup provider is cardless and below its free storage limit.
5. Verify GitHub Actions spending is zero and the database workflow uses the protected production environment.
6. Record the readings. If any check is uncertain, do not deploy.
