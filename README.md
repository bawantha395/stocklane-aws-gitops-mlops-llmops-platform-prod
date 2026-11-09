# Stocklane (prod, serverless)

Stock control **and a repair-job desk** for a vehicle workshop. Stock: scan or photograph a part, take it out or
put it back, see what to reorder. Workshop: a job per vehicle visit, a file per vehicle with its repair history,
invoices with payments, PDFs, and a "service due" list. The two parts are separate: a job's parts and labour are
typed in by the mechanic and never touch stock. This is the low-cost production version of the platform: **no servers, no cluster, no database
to keep running**. It costs about **$2-3 a month** at workshop scale and scales to zero when nobody is
using it.

| Piece | AWS service | Idle cost |
| --- | --- | --- |
| App (React PWA) | S3 (private) + CloudFront, your own domain | about 0 |
| API (inventory, workshop, forecast) | one Python Lambda behind an HTTP API | 0 |
| Photo matching, label drafts | one container Lambda (ONNX on CPU) | 0 |
| Data | DynamoDB on demand, point-in-time recovery | about 0 |
| Sign-in | Cognito (MFA required, two roles: OWNER, MECHANIC) | 0 |
| Encryption | one KMS key | $1 |
| Weekly photo training | SageMaker Processing job, billed only while it runs | cents |
| Nightly forecast | Chronos-Bolt on a GitHub runner | 0 |

Everything is created by Terraform from GitHub Actions. Nothing is installed on your computer.

## Run it from zero

You need: an AWS account, a **public Route 53 hosted zone** for a domain you own, and a GitHub account.
Pick the hostname for the app, for example `stocklane.example.com` (it must belong to that zone).

### 1. Put the code in a private GitHub repository

Create an empty **private** repository named `stocklane-aws-gitops-mlops-llmops-platform-prod`
on GitHub (no README), then from the folder you unzipped:

```bash
git init -b main && git add -A && git commit -m "Initial commit"
git remote add origin https://github.com/<you>/stocklane-aws-gitops-mlops-llmops-platform-prod.git
git push -u origin main
```

Folders that start with a dot (`.github`, `.gitignore`) are hidden in file explorers: turn on "show hidden files".

### 2. Create the foundation in AWS CloudShell

Sign in to the AWS console as an administrator, switch to the **Sydney (ap-southeast-2)** region, open
**CloudShell**, choose *Actions, Upload file* and upload the zip, then:

```bash
unzip stocklane-aws-gitops-mlops-llmops-platform-prod.zip && cd stocklane-aws-gitops-mlops-llmops-platform-prod
export EXPECTED_ACCOUNT=<your 12 digit account id> HOSTED_ZONE_ID=<your Route 53 zone id>
bash infra/ci/bootstrap.sh                                  # review only: creates a change set, changes nothing
EXECUTE=1 CREATE_ACCESS_KEY=1 bash infra/ci/bootstrap.sh    # does it, and creates the CI access key once
```

This creates the private Terraform state bucket and a restricted CI user that can only assume two roles
(`stocklane-prod-deploy`, `stocklane-prod-train`). It writes `deploy/generated/github-credentials.json`.

### 3. Tell GitHub about it

In the repository: **Settings, Secrets and variables, Actions**.

- **Variables** tab, new repository variable: `AWS_ACCOUNT_ID` = your 12 digit account id.
- **Secrets** tab, new repository secrets:
  - `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`: show them in CloudShell with
    `cat deploy/generated/github-credentials.json`, copy each value, then wipe the file:
    `shred -u deploy/generated/github-credentials.json`.
  - `TFVARS_JSON` (your values, one JSON document):

```json
{
  "route53_zone_id": "Z0123456789ABC",
  "web_domain": "stocklane.example.com",
  "owner_email": "you@example.com",
  "alert_email": "you@example.com"
}
```

Optional keys: `"bedrock_model_id": "amazon.nova-lite-v1:0"` and `"bedrock_region": "us-east-1"` turn on AI label
suggestions (request that model's access in the Bedrock console first; Sydney often has no quota, so use us-east-1);
`"monthly_budget_usd": 5`; `"enable_cloudtrail": false`; `"warm_vision": false`.

GitHub environments are not needed. Everything uses these repository settings.

### 4. Deploy

**Actions, Deploy, Run workflow.** The first run takes about 10 minutes (certificate validation and
CloudFront are the slow parts). It creates everything, builds and publishes the two images and the web app,
releases a first pretrained photo model, and indexes your photos. Later runs take a few minutes.

### 5. First sign-in

- AWS sends two emails to the addresses you gave: **confirm the alert subscription**, and Cognito's
  invitation with a temporary password for the owner.
- Open `https://<web_domain>`, sign in, set a new password and register an authenticator app (MFA is required).
- Add staff: Cognito console, your user pool, *Create user*, then add them to the **MECHANIC** group
  (owners are in **OWNER**).

### 6. Nothing else to schedule

| When (Asia/Colombo) | What runs by itself |
| --- | --- |
| Every night 01:30 | The API exports stock history |
| Every night 02:00 | **Nightly stock forecast** workflow publishes the forecast |
| Sunday 01:00 | The photo function exports the photos people confirmed |
| Sunday 02:30 | **Train photo model** trains, and releases the model only if it beats the current one |

Run any workflow by hand from the Actions tab. GitHub pauses scheduled workflows after 60 days with no commit;
any push turns them back on.

### 7. Using the workshop (every day)

Open **Workshop** in the left menu.

1. **New job.** Type the vehicle number first: if the vehicle has been here before, the owner, phone and model fill
   in by themselves and you see how many earlier jobs it has. Add the odometer, the complaint and the mechanic.
2. **Fill the job.** On the job page add **parts** (name, quantity, price) and **labour** lines by hand, an optional
   discount, and, if you like, the **next service** date or km. Press **Save** any time.
3. **Create invoice.** The job becomes **Invoiced** by itself and can no longer be edited. Download the **PDF**.
   (A job has only two states: *Open* and *Invoiced*.)
4. **Payments.** On the invoice press *Add a payment*: cash, card or bank, full or part. The invoice moves from
   *Unpaid* to *Part paid* to *Paid*. The **Invoices** tab shows what customers still owe.
5. **Vehicle file.** The **Vehicles** tab (or *Vehicle file* on a job) shows the owner, last km, next service and
   every earlier repair with its total. *Download history PDF* prints the whole history for the customer.
6. **Service due.** The tab lists vehicles whose next service date is within 14 days (or already past), or whose
   odometer is within 300 km of the service km, with the phone number to call.
7. **Owner only.** *Cancel job*, *Void invoice* (only when nothing was paid; the job opens again so you can fix it)
   and the **Report** tab (billed, received, unpaid, per mechanic, PDF). The report counts invoices by date.

Names, models and part names must be typed in English letters (the PDFs are English only). A vehicle number is
matched ignoring spaces and dashes, so `CAB-1234` and `cab 1234` are the same vehicle. If the owner changes, type the
new owner on the next job; the vehicle file follows the latest job and the old jobs keep the old name.

### Stopping it

**Actions, Destroy**, type `stocklane-prod`. It deletes the app **and its data** (the KMS key is deleted by AWS after
its 30-day wait). To remove the foundation as well, delete the CloudFormation stacks `stocklane-prod-identity`
and `stocklane-prod-state`.

## If something goes wrong

| Symptom | Cause and fix |
| --- | --- |
| Deploy fails on the certificate | The hostname is not in the hosted zone you gave. Fix `web_domain` or `route53_zone_id` in `TFVARS_JSON`, run again. |
| `Plan deletes or replaces resources` | Read the listed resources, then run Deploy again with *allow_deletions* ticked. |
| Sign-in loops or says redirect mismatch | `web_domain` in `TFVARS_JSON` changed after the first deploy: run Deploy again. |
| Scans say "photo model is not released yet" | The first Deploy did not finish the model step. Run Deploy again. |
| First scan takes about 10 seconds | Cold start of the photo function. During working hours a 5-minute ping keeps it warm. |
| No forecast on the reorder card | It needs stock history: the first nightly run after movements exist. Items start on the reorder-level rule. |
| Train says nothing to do | Not enough confirmed photos yet (60 photos, 15 per split, 3 items). That is normal for a new shop. |
| `AccessDenied` in a workflow | The foundation was changed. Run `bootstrap.sh` again with `EXECUTE=1` (without `CREATE_ACCESS_KEY`). |

## Security (all of it free)

- **Sign-in**: Cognito with MFA required, admin-created users only, 15-minute access tokens. API Gateway verifies the
  token; the Lambdas check the role (OWNER or MECHANIC) on every route.
- **Data**: DynamoDB and the media/model buckets are encrypted with one customer KMS key (rotated yearly); S3 blocks
  all public access and requires TLS; DynamoDB has point-in-time recovery and deletion protection.
- **Edge**: HTTPS only, TLS 1.2+, HSTS, a strict Content-Security-Policy, no framing, camera allowed for this site only.
  The web bucket is private and reachable only through CloudFront.
- **Abuse and cost**: API throttling (20 requests per second), alarms on errors and request floods, a monthly AWS Budget,
  and a daily cap on AI calls.
- **Least privilege**: each Lambda has its own role limited to this table, these buckets and this key. The CI user
  can only assume two roles, the deploy role is limited to this project's resource names, and the training role
  cannot touch infrastructure. Treat the deploy role like an administrator for this project.
- **Audit**: CloudTrail management events (kept 90 days), and API access logs.
- **Supply chain**: GitHub Actions pinned by commit, Trivy scans code and dependencies, `npm audit`, image scanning
  on push, model files verified by SHA256 before use.
- Not included because they cost real money every month: AWS WAF (about $5+) and GuardDuty. Add them if the
  app ever holds anything more sensitive than a workshop's stock.

## Layout

```
.github/workflows   deploy, destroy, ci, train, forecast (all inline shell)
.github/actions     aws-credentials, terraform
infra/ci            bootstrap.sh + CloudFormation foundation (state bucket, CI user and roles)
infra/terraform     environments/prod and modules: data, auth, api, edge, observability, ml
services/api        the Python API Lambda (inventory, workshop, forecast), no dependencies to build
services/vision     the photo Lambda (container image)
mlops               nightly forecast job and the weekly photo training pipeline
models              downloader for the first pretrained photo model
apps/web            React PWA
docs                MLOPS.md, OPERATIONS.md, WORKSHOP.md
```

## Design decisions

- **DynamoDB, one table.** Every stock change is one transaction: quantity, ledger, day totals and the
  idempotency record commit together, so a retry never double-posts. Access patterns are known and small.
- **Workshop is separate from stock.** Jobs, vehicles and invoices live under their own keys in the same table and never
  read or change inventory, so a workshop mistake can never unbalance the stock ledger. Invoices are rendered to PDF
  on request from the saved invoice, so they cannot drift from the record. Two people editing one job are protected by
  a revision number: the second save is refused with a clear message instead of overwriting the first.
- **One API function.** Inventory, workshop and forecast share one Lambda and one table: one cold start, one
  deployment, no service-to-service calls.
- **No database server, cache, queue or load balancer.** They are the monthly cost of the cluster version;
  nothing here needs them.
- **One name for app and API.** CloudFront serves the app and forwards `/api/*`, so there is no CORS and one certificate.
- **No Python in the pipeline.** The API ships as source; the workflows are inline shell.
