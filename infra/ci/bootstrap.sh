#!/usr/bin/env bash
# One-time foundation, run in AWS CloudShell. Creates two CloudFormation stacks (the private Terraform
# state bucket, and the restricted CI user with its deploy/train roles) and prints what to put into GitHub.
# Without EXECUTE=1 it only creates change sets so you can review them first.
#
#   EXPECTED_ACCOUNT=123456789012 HOSTED_ZONE_ID=Z... bash infra/ci/bootstrap.sh              # review
#   EXPECTED_ACCOUNT=... HOSTED_ZONE_ID=... EXECUTE=1 CREATE_ACCESS_KEY=1 bash infra/ci/bootstrap.sh   # first real run
set -euo pipefail

: "${EXPECTED_ACCOUNT:?12-digit AWS account id}" "${HOSTED_ZONE_ID:?Route 53 hosted zone id}"
REGION="${AWS_REGION:-ap-southeast-2}"
PROJECT_NAME="${PROJECT_NAME:-stocklane-prod}"
export AWS_DEFAULT_REGION="$REGION"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
[ "$ACCOUNT" = "$EXPECTED_ACCOUNT" ] || { echo "Signed in to $ACCOUNT, expected $EXPECTED_ACCOUNT" >&2; exit 1; }
aws route53 get-hosted-zone --id "$HOSTED_ZONE_ID" >/dev/null
STATE_BUCKET="${PROJECT_NAME}-tfstate-${ACCOUNT}-${REGION}"

deploy() { # stack template parameter-overrides...
  local stack="$1" template="$2"; shift 2
  local flags=(--no-fail-on-empty-changeset --capabilities CAPABILITY_NAMED_IAM)
  [ "${EXECUTE:-}" = "1" ] || flags+=(--no-execute-changeset)
  aws cloudformation deploy --stack-name "$stack" --template-file "$template" "${flags[@]}" --parameter-overrides "$@"
}

deploy "${PROJECT_NAME}-state" "$HERE/state.json" BucketName="$STATE_BUCKET" ProjectName="$PROJECT_NAME"
if [ "${EXECUTE:-}" != "1" ]; then
  echo "Change set created for the state stack. Review it in the console, then run again with EXECUTE=1."
  exit 0
fi
deploy "${PROJECT_NAME}-identity" "$HERE/identity.yaml" ProjectName="$PROJECT_NAME" StateBucketName="$STATE_BUCKET" HostedZoneId="$HOSTED_ZONE_ID"

OUT="$HERE/../../deploy/generated"; mkdir -p "$OUT"; umask 077
if [ "${CREATE_ACCESS_KEY:-}" = "1" ]; then
  aws iam create-access-key --user-name "${PROJECT_NAME}-github-ci" --query AccessKey > "$OUT/github-credentials.json"
  echo "Access key written to deploy/generated/github-credentials.json (private, shown once, git-ignored)."
fi

echo
echo "GitHub repository variable:  AWS_ACCOUNT_ID=$ACCOUNT"
echo "GitHub secrets:              AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY (from github-credentials.json), TFVARS_JSON"
echo "TFVARS_JSON starting point (fill in the two emails and your hostname; see README, Run it from zero):"
jq -n --arg z "$HOSTED_ZONE_ID" '{route53_zone_id:$z, web_domain:"stocklane.example.com", owner_email:"you@example.com", alert_email:"you@example.com"}' | tee "$OUT/tfvars-example.json"
