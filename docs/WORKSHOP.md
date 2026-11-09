# Workshop data and API

Single table, keys (`pk` / `sk`):

| Record | Key | Holds |
| --- | --- | --- |
| Job | `WJOB` / job id | customer, phone, vehicle, odometer, complaint, mechanic, `parts[]`, `labour[]`, discount, next service, `status` OPEN, INVOICED or CANCELLED, `revision` |
| Vehicle | `VEHICLE` / registration without spaces or dashes | owner, phone, make, last km, next service date and km |
| History row | `VJOB#<registration>` / `<created>#<job id>` | one small row per job for the vehicle page |
| Invoice | `WINV` / invoice id | snapshot of the job's lines and totals, `payments[]`, `paid`, status UNPAID, PARTIAL, PAID or VOID |

Invoice numbers look like `INV-20261110-9AC7CC` (Colombo date plus a random part). Money is LKR, two decimals.

| Route | Who | What |
| --- | --- | --- |
| `GET/POST /api/workshop/jobs` | staff | list, create (also creates or updates the vehicle file) |
| `GET/PATCH /api/workshop/jobs/{id}` | staff | read, save details and lines (send the `revision` you loaded) |
| `POST /api/workshop/jobs/{id}/invoice` | staff | create the invoice, the job becomes INVOICED |
| `POST /api/workshop/jobs/{id}/cancel` | owner | cancel an open job |
| `GET /api/workshop/invoices`, `/{id}`, `/{id}/pdf` | staff | list, read, PDF |
| `POST /api/workshop/invoices/{id}/payments` | staff | add a payment (never more than the balance) |
| `POST /api/workshop/invoices/{id}/void` | owner | void an unpaid invoice, the job opens again |
| `GET /api/workshop/vehicles`, `/{reg}`, `/{reg}/history.pdf` | staff | search, vehicle file with history, history PDF |
| `GET /api/workshop/service-due` | staff | vehicles due within 14 days or 300 km |
| `GET /api/workshop/report`, `/report.pdf` | owner | totals for `?from=YYYY-MM-DD&until=YYYY-MM-DD` |

Every write needs an `Idempotency-Key` header (the app sends one), so a retry after a bad connection never creates a
second job, invoice or payment.
