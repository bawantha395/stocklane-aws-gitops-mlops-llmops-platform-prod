# AI and MLOps

Three kinds of AI, none of them needing a manual step. Live inference runs in Lambda; SageMaker is used only
for the weekly photo training, so nothing bills in between.

| Feature | Model | Where it runs |
| --- | --- | --- |
| Stock forecast (what to reorder) | Pretrained **Chronos-Bolt** (`amazon/chronos-bolt-small`), used as it is | Nightly job on a GitHub runner; the API Lambda reads the result from S3 |
| Find an item from a photo | Frozen MobileNetV2 features + a same-item calibrator trained on photos people confirmed | Photo Lambda; retrained weekly on SageMaker |
| Read a label into a draft item | Textract first, then Amazon Bedrock Nova Lite (Converse API with tool use) for missing fields | On demand from the photo Lambda |

## Forecast: a pretrained model, nothing to train

1. The API Lambda writes every item's daily use to S3 each night (01:30). Days when an item was out of stock are
   filled with its in-stock average, so a stock-out is not read as "no demand".
2. The nightly workflow (`forecast.yml`, `mlops/forecast/run_forecast.py`) gives Chronos-Bolt each item's history.
3. **Back-test gate.** For every item the model first forecasts the item's own most recent days (7 to 28) from the days
   before them. If the error (WAPE) is above 60 %, that item's forecast is not released.
4. Released forecasts give "runs out in about N days" and an order quantity. Everything else (fewer than 21 days of
   history, or irregular use) uses the **reorder-level rule**.
5. If the job fails, yesterday's forecast stays. Nothing here changes stock.

## Photo matcher: retrains itself

| When | What happens by itself |
| --- | --- |
| Every Sunday 01:00 (Asia/Colombo) | The photo Lambda exports every photo a person confirmed as a dataset (needs 60 photos, 15 in each split across 3 items) |
| Every Sunday 02:30 | `train.yml` trains the calibrator, but only if the photos changed. It runs as a **SageMaker Processing job on `ml.t3.large`** (new accounts usually have no training-instance quota) |
| After training | `auto_promote.py` approves the version only if it passed the quality gate **and** beats the served model (higher test F1, precision at least 98 %); otherwise it is rejected with the reason |
| After approval | `train.yml` copies the model to `releases/` and points `config/model.json` at it; the photo Lambda loads it within five minutes and re-indexes the photos |

The quality gate picks its threshold on a validation split and judges on an independent test split. Until a model
passes, the pretrained MobileNetV2 with a fixed similarity limit is used.

## Guard rails

- A person always confirms stock movements; similarity scores are not confidence percentages.
- Bedrock may only suggest visible label fields. It cannot change quantities or approve items. Calls are limited to
  50 a day (a DynamoDB counter). When Bedrock is unavailable, Textract's text still fills what it can.
- Model files are checksum-verified before use (ONNX with a pinned SHA256; Chronos weights as `.safetensors`).

## Image model

`models/download_model.py` downloads the 14 MB ONNX Model Zoo MobileNetV2, checks its checksum and exports the
1280-dimension feature encoder. The Deploy workflow does this once and uploads it as the first model. It is an
ImageNet-pretrained baseline, not a workshop-trained recogniser: it retrieves approved reference photos and a person
always confirms. Never use similarity for unattended stock posting.

## Bedrock region

New Sydney accounts often have zero Bedrock quota, so set `bedrock_region` to `us-east-1` in `TFVARS_JSON`. The photo
Lambda's role may invoke only the one model you name, in that region. No API key is used.

## Where things live

| Object | Location |
| --- | --- |
| Current model pointer | `s3://stocklane-prod-models-<account>/config/model.json` |
| Image digests, deployment settings | `config/images.json`, `config/current.json` |
| Forecast history and result | `forecast/datasets/...`, `forecast/current.json` |
| Confirmed-photo datasets | `datasets/<sha>/`, `datasets/workshop/latest.json` |
| Released models | `releases/<version>/<sha>.tar.gz` |
