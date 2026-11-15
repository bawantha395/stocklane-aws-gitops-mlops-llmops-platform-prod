# Go-live checklist

Do these in order. The deploy is one workflow; nothing here needs the AWS console except the optional restore test.

## 1. Before the deploy
- [ ] CI is green on `main` (Actions, CI). The Deploy workflow runs the same tests first and stops if they fail.
- [ ] Read `git diff` of what you are shipping. This release adds API routes (`POST /api/workshop/vehicles/{id}/owner`, `POST /api/workshop/invoices/{id}/refund`, `GET /api/workshop/export`, `POST /api/workshop/jobs/{id}/stage`) and changes how a job saves the vehicle file. No table or infrastructure change, so the plan should show only the Lambda image and the web files changing.
- [ ] Take a copy of the data first: sign in as owner, Setup, **Download all data**. Keep the file.

## 2. Deploy
1. Push to `main`.
2. Actions, **Deploy**, Run workflow. Leave "Allow deletions" **off**. If the plan shows anything being deleted or replaced that you did not expect, stop and read it.
3. The workflow builds the images, applies Terraform (this updates the Lambda, which includes the logo upload fix for `workshop/photos/logo/`), syncs the web app to S3 and invalidates CloudFront for `/index.html` and `/config.js`. Asset files have new names each build, so nothing else needs invalidating.

## 3. Check it (about 5 minutes)
- [ ] Open the site in a private window. Hard refresh. Sign in as owner.
- [ ] Run the smoke test (read only, safe): see `scripts/smoke_test.py`. If `GET /api/workshop/export` fails with 404 the new API is not live yet.
- [ ] Run it once more with `--write` (owner token). It makes a test vehicle, a bill, a payment, a refund, voids it and deletes the jobs. It leaves vehicle `ZZSMOKE1` and one VOID invoice behind, by design.
- [ ] Setup: upload the logo. It should save and show on the next bill.
- [ ] Make a real job on your phone and a bill from it. Print it or save the PDF. Look at the PDF on the phone.
- [ ] Vehicle page: **Edit details**, **New owner**, and the repair history.
- [ ] New job for a known vehicle with a different name: the "Is this a new owner?" question appears (4 choices).
- [ ] Job page: tap a stage (Ready for pickup), then "Tell the customer it is ready" opens WhatsApp with the message. Set a warranty and "brought in by", make the bill, and check both lines on the PDF.

## 4. Backups
- DynamoDB point-in-time recovery is **on** (35 days). A restore makes a new table, so ask someone who knows the AWS console, and try it once before you need it.
- The JSON from **Download all data** is your own copy. Keep one now and then (monthly is fine). Photos are not in it; they live in the photos bucket.

## 5. If something is wrong
- Errors: CloudWatch log group `/aws/lambda/stocklane-prod-api`.
- Roll back: revert the commit on `main` and run **Deploy** again. Data written by the new version stays valid for the old one (new fields are ignored), so a rollback is safe.
- Staff cannot sign in: Cognito user pool `stocklane-prod`, check the user is enabled and in group MECHANIC or OWNER.

## 6. First week on real jobs
- Use it on a real phone (iPhone Safari and Android Chrome) for a few days before you stop the paper book.
- Watch for: the top bar while scrolling, printing on the thermal printer, the share sheet when sending a bill on WhatsApp.
