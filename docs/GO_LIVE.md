# Go-live checklist (Ganga Motors)

Do these in order. Tick each box yourself. Nothing here destroys infrastructure: Terraform is **plan, then apply, never destroy**.

## 0. What is already checked for you
- Automated tests (`cd services/api && python3 -m pytest -q`): all pass in this build. The web app type-checks and builds.
- Practice mode (the training mode in the app) makes **zero** real API calls. This was checked by script.
- Not checked by anyone yet: everything marked "on your phone" below. Those need a real device.

## 1. Deploy to staging first (11.2)
1. `terraform plan`. Expect these **new** things and nothing unexpected being replaced or deleted:
   - `aws_apigatewayv2_route.public` (`GET /api/public/{proxy+}`, no sign-in) and `aws_apigatewayv2_route.public_post` (`POST ...`, the customer's Approve / Decline)
   - stage route settings for those two (low throttle on purpose)
   - the Lambda code update
   If the plan wants to delete or replace the table, user pool or buckets, **stop**.
2. `terraform apply`, then Deploy the web app (the Deploy workflow does both; leave "Allow deletions" off).
3. Cognito groups. There are five: `OWNER`, `ADMIN`, `STOREKEEPER`, `MECHANIC`, `PLATFORM`. Put your own user in `OWNER` and `PLATFORM`. Make one test user per role (owner, admin, storekeeper, mechanic) and sign in as each.
4. Run the smoke test: `python3 scripts/smoke_test.py --base https://workshop.bawantha-rathnayake.tech --token <owner access token>` (read only), then once with `--write`. It now also checks the customer link: a wrong link answers 404 with no sign-in, a real link shows the job and no costs, and a switched-off link answers 404.

## 2. On your phone (11.3): Android Chrome and iPhone Safari
- [ ] Sign in, add to home screen. Practice mode opens and works.
- [ ] Camera: take a vehicle photo, scan a QR (job card, shelf label), scan a barcode. Beep / buzz on a good scan.
- [ ] Print: thermal printer (bill, job card) and the label sheet from the Store room.
- [ ] Slow network: Chrome DevTools "Slow 3G" or a weak signal. A save shows "Saving..." and never makes two bills.
- [ ] Customer link: make a link on a job, send it by WhatsApp **to another phone**, open it with no sign-in. Check stage, price, photos, bill, pay QR. Switch it off, open again: "This link is not working".
- [ ] Estimate: send an estimate, open its link on the other phone, Approve. The workshop page shows "Approved by the customer: name".
- [ ] Message centre: mark a job Ready. Messages shows "Vehicle ready" with the link in the text. Press WhatsApp, then Sent. It does not come back.

## 3. Money check (11.4)
- [ ] Make about 10 real-looking jobs on a shop with tax on. For each: job, parts from stock, labour, bill, payment (cash, card, part payment), one refund, one void.
- [ ] Compare by hand with a calculator: bill totals, tax, discount, what the customer owes, profit. Reports > Month summary must match Home > Owner summary.
- [ ] Owner summary: "Profit today" must equal the report for today. A part without a known cost is counted as "left out", never guessed.
- [ ] Alerts: a sale below cost, a big discount (over 10 percent), a void, a refund, a stock count change, a cost edit and a supplier return each show up once. Tick Seen.

## 4. Backup, alarms, rollback (11.5)
- DynamoDB point-in-time recovery is on (35 days). A restore makes a **new table**. Practice one restore before you need it.
- Download your own copy: Setup, **Your data**, Download all data. Do it now, and monthly. Photos are not in it (they are in the media bucket).
- Budget alarm and error alarms exist (monthly budget, Lambda errors, API 5xx, API throttled). They email the address in `alert_email` through SNS. **Open the "confirm subscription" email once**, or no alarm will ever reach you. Check the budget amount in `monthly_budget_usd` (default 5 USD) matches the 3 USD plan.
- Rollback: keep the previous zip (`stocklane-prod-0200` and the one before). To go back, deploy the older zip's code. New fields are ignored by older code, so rolling back is safe. Do not delete the table.
- Errors: CloudWatch log group `/aws/lambda/<name>-api`.

## 5. Clear the demo data and set up the real shop (11.6)
Order matters. Do it once, on the day.
1. Download all data (section 4) and keep the file.
2. Look first: `python3 scripts/clear_shop.py --table <table name> --shop main` shows what would go and deletes nothing.
3. Delete: add `--yes --confirm main`. Add `--keep-settings` to keep business details and message words. Invoice and job numbers start again from 1. Photos in the media bucket stay (delete them by hand if you want).
4. In the app, in this order:
   1. Setup > Business details: name, address, phone, logo, bank, payment QR
   2. Tax and discount, payment terms, bill notes
   3. Workshop: labour buttons, mechanics, module switches (store room, counter), Allow Sinhala if wanted
   4. Store room: racks and shelves (or Quick start), then Print labels and stick them on
   5. Shelves and categories, then Suppliers (with credit days)
   6. Staff: add each person and set Who can do what (Admin, Storekeeper, Mechanic). Alerts and the Owner summary are owner-only by default
   7. Stock: import parts from CSV (Stock > Import), then count shelf by shelf
   8. Customer messages: read the words (English and Sinhala) and change them to your style
5. Open one real job end to end before the first customer arrives.

## 6. Training (11.7)
- Owner: one session, practice mode only. Cover Home, Owner summary, Alerts, Messages, Reports, Month summary, Price review, Settings.
- Mechanic: one short session, practice mode only. Cover New job, parts, stage, photos (before, after, old parts), Customer link, Counter, Batch in.
- Practice mode never touches real data. Say that out loud so nobody is afraid to press things.

## 7. Pilot (11.8)
- Three days using it **next to** the paper book. Compare the end of each day: money in, who owes.
- Watch for: slow screens, the printer, WhatsApp opening with the right words, staff who cannot find a button.
- After three clean days, stop the paper book. Then widen to the next shop.

## 8. If something is wrong
- Staff cannot sign in: Cognito user pool, check the user is enabled and in the right group.
- A customer link says "not working": it expired (14 days by default), was switched off, or the address was copied badly. Make a new one on the job page.
- The customer page or Approve button does not load at all: the two public routes are missing (Terraform not applied yet), or the API throttle for them was hit (a flood of tries).
- "Too many tries": one phone address made more than 20 wrong tries in 10 minutes. It clears itself.
