# Everything the workflows and scripts need, in one JSON document. The Deploy workflow stores it
# in the models bucket (config/current.json) so Train and Forecast can find the environment.
output "deployment" {
  value = {
    region              = var.region
    account_id          = local.account_id
    name                = var.name
    environment         = "prod"
    table               = module.data.table_name
    web_bucket          = module.data.buckets["web"].id
    media_bucket        = module.data.buckets["media"].id
    model_bucket        = module.data.buckets["models"].id
    distribution_id     = module.edge.distribution_id
    web_url             = module.edge.web_url
    api_function        = module.api.api_function
    vision_function     = module.api.vision_function
    user_pool_id        = module.auth.user_pool_id
    web_client_id       = module.auth.web_client_id
    cognito_domain      = module.auth.domain
    training_role_arn   = module.ml.training_role_arn
    model_package_group = module.ml.model_package_group
    vision_repository   = module.data.repositories["vision"].url
    training_repository = module.data.repositories["ml-training"].url
    bedrock_model_id    = var.bedrock_model_id
    bedrock_region      = module.ml.bedrock_region
  }
}
