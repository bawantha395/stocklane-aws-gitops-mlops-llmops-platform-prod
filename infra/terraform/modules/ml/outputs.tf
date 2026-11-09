output "training_role_arn" {
  value = aws_iam_role.training.arn
}

output "model_package_group" {
  value = aws_sagemaker_model_package_group.vision.model_package_group_name
}

output "bedrock_invoke_arn" {
  value = local.bedrock_arn
}

output "bedrock_region" {
  value = local.bedrock_region
}
