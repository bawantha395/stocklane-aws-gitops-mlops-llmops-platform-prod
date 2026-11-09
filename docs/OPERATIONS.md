# Operations

## Everyday

| Task | How |
| --- | --- |
| Deploy a change | Push to `main`, then **Actions, Deploy** (it tests first) |
| Add a staff member | Cognito, user pool `stocklane-prod`, *Create user*, add to group MECHANIC (or OWNER) |
| Remove access | Cognito, disable the user. Their token stops working within 15 minutes |
| See errors | CloudWatch log groups `/aws/lambda/stocklane-prod-api` and `-vision` (30 days), alarms email `alert_email` |
| See who did what | `actor` on every movement; API access log `/aws/apigateway/stocklane-prod`; CloudTrail for AWS changes |
| Run a forecast now | Actions, **Nightly stock forecast**, Run workflow |
| Train now | Actions, **Train photo model**, Run workflow |

## Cost (about $2-3 a month)

| Item | Approx. per month |
| --- | --- |
| KMS key | $1.00 |
| Image registry storage (two images) | $0.15 |
| DynamoDB, S3, CloudTrail logs, CloudWatch logs | $0.10-0.50 |
| Lambda, API Gateway, CloudFront, Cognito, SNS, 4 alarms, 1 budget | $0 within free tiers |
| SageMaker training (only when 60+ confirmed photos exist and photos changed) | $0.05-0.20 |
| Bedrock Nova Lite and Textract (label drafts, capped 50 a day) | cents |

Not included: your domain registration, and the Route 53 hosted zone ($0.50) if you do not already have one.
Set `monthly_budget_usd` in `TFVARS_JSON`; AWS emails at 80 % actual and 100 % forecast.

The warm-up ping (every 5 minutes, 08:30-19:00, Mon-Sat) keeps scans fast and costs nothing in free tier. Turn it off
with `"warm_vision": false`.

## Backups and recovery

- DynamoDB point-in-time recovery keeps 35 days. Restore from the console into a **new** table (*Restore to point in
  time*), check it, and either point the functions at it (`TABLE` environment variable) or copy the items back.
- S3: the models bucket is versioned (30 days). Photos are written once and never overwritten. Invoice PDFs are not stored: they are drawn on request from the invoice record in DynamoDB.
- Terraform state is in a versioned private bucket.

## Limits worth knowing

- A request body is capped by Lambda at 6 MB, so photo uploads are limited to 4 MB (the app sends camera photos well below that).
- Reports read per-day totals, so they scale with days times items moved, not with every movement.
- The API accepts about 20 requests a second in total. A workshop uses a fraction of that. Raise `throttle_rate` in the
  `api` module if you ever need more.
- Deploys are manual on purpose. Add `push:` to `deploy.yml` if you want deploys on every merge.
