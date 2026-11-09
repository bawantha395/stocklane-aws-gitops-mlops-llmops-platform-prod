# Infrastructure

- `ci/` is the foundation, created once in CloudShell by `bootstrap.sh`: the private Terraform state bucket
  (`state.json`) and the restricted CI user with its `deploy` and `train` roles (`identity.yaml`).
- `terraform/environments/prod` wires the modules; `terraform/modules` holds `data` (KMS, DynamoDB, S3, ECR),
  `auth` (Cognito), `api` (Lambdas, HTTP API, schedules), `edge` (CloudFront, certificate, DNS),
  `observability` (budget, alarms, CloudTrail, Access Analyzer) and `ml` (SageMaker role, Model Registry, Bedrock access).
- Inputs: `terraform.tfvars` (committed protection settings) plus `pipeline.auto.tfvars.json`, written by the workflow
  from the `TFVARS_JSON` secret. Nothing account-specific is committed.
- The `deployment` output lists everything the workflows need; Deploy stores it at `config/current.json` in the models bucket.
