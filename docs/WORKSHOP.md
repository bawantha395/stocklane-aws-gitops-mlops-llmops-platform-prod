# Workshop data and API

Single table, keys (`pk` / `sk`):

| Record | Key | Holds |
| --- | --- | --- |
| Job | `WJOB` / job id | customer, phone, vehicle, odometer, complaint, mechanic, `parts[]`, `labour[]`, discount, next service, `status` OPEN, INVOICED or CANCELLED, `revision` |
| Vehicle | `VEHICLE` / registration without spaces or dashes | owner, phone, make, last km, next service date and km |
| History row | `VJOB#<registration>` / `<created>#<job id>` | one small row per job for the vehicle page |
| Business settings | `WSET` / `business` | name, address, phone, email, registration no, bank, footer, tax name and rate |
| Invoice | `WINV` / invoice id | snapshot of the job's lines, totals, tax and the business header of the issue day, `payments[]`, `paid`, status UNPAID, PARTIAL, PAID or VOID |

Invoice numbers look like `INV-20261110-9AC7CC` (Colombo date plus a random part). Money is LKR, two decimals.

| Route | Who | What |
| --- | --- | --- |
| `GET/POST /api/workshop/jobs` | staff | list, create (also creates or updates the vehicle file) |
| `GET/PATCH /api/workshop/jobs/{id}` | staff | read, save details and lines (send the `revision` you loaded) |
| `POST /api/workshop/jobs/{id}/invoice` | staff | create the invoice, the job becomes INVOICED |
| `POST /api/workshop/jobs/{id}/cancel` | owner | cancel an open job |
| `POST /api/workshop/jobs/{id}/archive`, `/restore` | owner | delete a job into the Archive (reason required), or bring it back |
| `POST /api/workshop/jobs/{id}/undo` | staff | take back a job opened by mistake (its creator, first 10 minutes, still open) |
| `POST /api/workshop/jobs/{id}/delete-request`, `/delete-request/reject` | staff request, owner reject | a mechanic asks for a delete, the owner rejects (approving is `archive`) |
| `GET /api/workshop/archive` | owner | deleted jobs and the log of who did what |
| `GET /api/workshop/invoices`, `/{id}`, `/{id}/pdf` | staff | list, read, PDF |
| `POST /api/workshop/invoices/{id}/payments` | staff | add a payment (never more than the balance) |
| `POST /api/workshop/invoices/{id}/void` | owner | void an unpaid invoice, the job opens again |
| `GET /api/workshop/vehicles`, `/{reg}`, `/{reg}/history.pdf` | staff | search, vehicle file with history, history PDF |
| `PATCH /api/workshop/vehicles/{reg}` | staff | correct owner, phone, make, notes |
| `GET /api/workshop/dashboard`, `/suggestions` | staff | home figures; part and labour names and prices used before |
| `GET/PUT /api/workshop/settings` | staff read, owner write | business details and tax |
| `GET /api/workshop/service-due` | staff | vehicles due within 14 days or 300 km |
| `GET /api/workshop/report`, `/report.pdf` | owner | totals for `?from=YYYY-MM-DD&until=YYYY-MM-DD` |

## Who can do what

| | Mechanic | Owner |
| --- | --- | --- |
| Open a job, edit lines and notes, create the invoice, take payments, print | yes | yes |
| Undo a job opened by mistake (own job, first 10 minutes, still open) | yes | yes |
| Discount | up to the limit in Settings (default 10% of parts and labour) | any |
| Ask for a job to be deleted (a reason is required) | yes | not needed |
| Delete a job (open or cancelled), cancel a job, void an unpaid invoice, restore from the Archive | no | yes |
| Reports, Settings, Archive and its log | no | yes |

Delete never destroys data. The job moves to the Archive (status `ARCHIVED`) with who, when and why, and is hidden from the
jobs list, the vehicle history and reports. Restore brings it back as it was (open or cancelled). A job with an invoice
cannot be deleted: void the invoice first (only possible when nothing was paid), then delete. A paid invoice is never
deleted. Every delete, request, rejection, restore, undo, cancel and void is written to the log (`WAUDIT` rows).
A request is one `WREQ` row per job: pending until the owner approves (delete) or rejects with a note.

The PDF routes answer JSON `{filename, pdf}` (base64), so a PDF travels like every other call and the browser saves it.

Every write needs an `Idempotency-Key` header (the app sends one), so a retry after a bad connection never creates a
second job, invoice or payment.
