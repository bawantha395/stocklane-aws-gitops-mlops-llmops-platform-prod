# Everything that holds data: one KMS key, one DynamoDB table, three private S3 buckets,
# and the two image repositories. Nothing here costs money while idle except the key ($1/month).

data "aws_caller_identity" "current" {}

resource "aws_kms_key" "main" {
  description             = "${var.name} data key (DynamoDB and S3)"
  enable_key_rotation     = true
  deletion_window_in_days = 30
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AccountAdministration"
      Effect    = "Allow"
      Principal = { AWS = "arn:aws:iam::${var.account_id}:root" }
      Action    = "kms:*"
      Resource  = "*"
    }]
  })
}

resource "aws_kms_alias" "main" {
  name          = "alias/${var.name}"
  target_key_id = aws_kms_key.main.key_id
}

# ---------- DynamoDB ----------
resource "aws_dynamodb_table" "main" {
  name                        = var.name
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = "pk"
  range_key                   = "sk"
  deletion_protection_enabled = !var.force_destroy
  attribute {
    name = "pk"
    type = "S"
  }
  attribute {
    name = "sk"
    type = "S"
  }
  ttl {
    attribute_name = "ttl"
    enabled        = true
  }
  point_in_time_recovery {
    enabled = true
  }
  server_side_encryption {
    enabled     = true
    kms_key_arn = aws_kms_key.main.arn
  }
}

# ---------- S3 ----------
locals {
  buckets = {
    web    = { kms = false }
    media  = { kms = true }
    models = { kms = true }
  }
}

resource "aws_s3_bucket" "this" {
  for_each      = local.buckets
  bucket        = "${var.name}-${each.key}-${var.account_id}"
  force_destroy = var.force_destroy
}

resource "aws_s3_bucket_public_access_block" "this" {
  for_each                = local.buckets
  bucket                  = aws_s3_bucket.this[each.key].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "this" {
  for_each = local.buckets
  bucket   = aws_s3_bucket.this[each.key].id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  for_each = local.buckets
  bucket   = aws_s3_bucket.this[each.key].id
  rule {
    bucket_key_enabled = each.value.kms
    apply_server_side_encryption_by_default {
      sse_algorithm     = each.value.kms ? "aws:kms" : "AES256"
      kms_master_key_id = each.value.kms ? aws_kms_key.main.arn : null
    }
  }
}

resource "aws_s3_bucket_versioning" "models" {
  bucket = aws_s3_bucket.this["models"].id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_lifecycle_configuration" "models" {
  bucket = aws_s3_bucket.this["models"].id
  rule {
    id     = "expire-old"
    status = "Enabled"
    filter {
      prefix = ""
    }
    noncurrent_version_expiration {
      noncurrent_days = 30
    }
    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
  rule {
    id     = "expire-training-scratch"
    status = "Enabled"
    filter {
      prefix = "training/"
    }
    expiration {
      days = 30
    }
  }
}

# The web bucket policy (CloudFront only) lives in the edge module; the others allow TLS only.
resource "aws_s3_bucket_policy" "tls" {
  for_each = { for k, v in local.buckets : k => v if k != "web" }
  bucket   = aws_s3_bucket.this[each.key].id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "RequireTLS"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.this[each.key].arn, "${aws_s3_bucket.this[each.key].arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
}

# ---------- Image repositories ----------
resource "aws_ecr_repository" "this" {
  for_each             = toset(["vision", "ml-training"])
  name                 = "${var.name}/${each.key}"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = var.force_destroy
  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "this" {
  for_each   = aws_ecr_repository.this
  repository = each.value.name
  policy = jsonencode({ rules = [{
    rulePriority = 1
    description  = "Keep the last 5 images"
    selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 5 }
    action       = { type = "expire" }
  }] })
}
