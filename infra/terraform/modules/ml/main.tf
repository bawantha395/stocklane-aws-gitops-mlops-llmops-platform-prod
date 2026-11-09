# SageMaker training role, the Model Registry group, and the Bedrock model the photo function may call.
# Training runs weekly as a short SageMaker Processing job (see mlops/vision/sagemaker_jobs.py);
# nothing runs, and nothing is billed, between jobs.

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  bedrock_region = var.bedrock_region != "" ? var.bedrock_region : var.region
  bedrock_arn    = var.bedrock_model_id == "" ? "" : "arn:${data.aws_partition.current.partition}:bedrock:${local.bedrock_region}::foundation-model/${var.bedrock_model_id}"
}

resource "aws_iam_role" "training" {
  name = "${var.name}-sagemaker-training"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect    = "Allow", Principal = { Service = "sagemaker.amazonaws.com" }, Action = "sts:AssumeRole"
    Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id } }
  }] })
}

resource "aws_iam_role_policy" "training" {
  name = "train-from-reviewed-datasets"
  role = aws_iam_role.training.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["s3:ListBucket"], Resource = var.models_bucket_arn },
    { Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject"], Resource = "${var.models_bucket_arn}/*" },
    { Effect = "Allow", Action = ["ecr:GetAuthorizationToken"], Resource = "*" },
    { Effect = "Allow", Action = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"], Resource = var.training_repository_arn },
    { Effect = "Allow", Action = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"], Resource = "arn:${data.aws_partition.current.partition}:logs:${var.region}:${data.aws_caller_identity.current.account_id}:log-group:/aws/sagemaker/*" },
    { Effect = "Allow", Action = ["kms:GenerateDataKey", "kms:Decrypt", "kms:Encrypt"], Resource = var.kms_key_arn }
  ] })
}

resource "aws_sagemaker_model_package_group" "vision" {
  model_package_group_name        = "${var.name}-visual-sku"
  model_package_group_description = "Versioned visual encoder and same-SKU similarity calibration; approved automatically only when it beats the served model"
}
