output "kms_key_arn" {
  value = aws_kms_key.main.arn
}

output "table_name" {
  value = aws_dynamodb_table.main.name
}

output "table_arn" {
  value = aws_dynamodb_table.main.arn
}

output "buckets" {
  value = { for k, b in aws_s3_bucket.this : k => { id = b.id, arn = b.arn, regional_domain_name = b.bucket_regional_domain_name } }
}

output "repositories" {
  value = { for k, r in aws_ecr_repository.this : k => { url = r.repository_url, arn = r.arn } }
}
