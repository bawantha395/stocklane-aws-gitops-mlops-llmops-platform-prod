locals {
  account_id = data.aws_caller_identity.current.account_id
}

module "data" {
  source        = "../../modules/data"
  name          = var.name
  account_id    = local.account_id
  force_destroy = !var.deletion_protection
}

module "auth" {
  source              = "../../modules/auth"
  name                = var.name
  account_id          = local.account_id
  owner_email         = var.owner_email
  app_urls            = ["https://${var.web_domain}"]
  deletion_protection = var.deletion_protection
}

module "ml" {
  source                  = "../../modules/ml"
  name                    = var.name
  region                  = var.region
  models_bucket_arn       = module.data.buckets["models"].arn
  training_repository_arn = module.data.repositories["ml-training"].arn
  kms_key_arn             = module.data.kms_key_arn
  bedrock_model_id        = var.bedrock_model_id
  bedrock_region          = var.bedrock_region
}

module "api" {
  source             = "../../modules/api"
  name               = var.name
  region             = var.region
  source_dir         = "${path.root}/../../../../services/api"
  table_arn          = module.data.table_arn
  table_name         = module.data.table_name
  kms_key_arn        = module.data.kms_key_arn
  media_bucket       = module.data.buckets["media"]
  models_bucket      = module.data.buckets["models"]
  user_pool_id       = module.auth.user_pool_id
  web_client_id      = module.auth.web_client_id
  vision_image_uri   = var.vision_image_uri
  bedrock_invoke_arn = module.ml.bedrock_invoke_arn
  bedrock_model_id   = var.bedrock_model_id
  bedrock_region     = module.ml.bedrock_region
  warm_vision        = var.warm_vision
}

module "edge" {
  source          = "../../modules/edge"
  providers       = { aws = aws, aws.us_east_1 = aws.us_east_1 }
  name            = var.name
  region          = var.region
  route53_zone_id = var.route53_zone_id
  web_domain      = var.web_domain
  web_bucket      = module.data.buckets["web"]
  api_endpoint    = module.api.api_endpoint
}

module "observability" {
  source             = "../../modules/observability"
  name               = var.name
  account_id         = local.account_id
  alert_email        = var.alert_email
  monthly_budget_usd = var.monthly_budget_usd
  function_names     = module.api.function_names
  api_id             = module.api.api_id
  force_destroy      = !var.deletion_protection
  enable_cloudtrail  = var.enable_cloudtrail
}
