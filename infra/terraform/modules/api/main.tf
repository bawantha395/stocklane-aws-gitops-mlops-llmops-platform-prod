# The API: one Python Lambda for inventory/workshop/forecast, one container Lambda for photos,
# an HTTP API with a Cognito JWT authorizer, and the schedules. All pay-per-request.

data "aws_partition" "current" {}

locals {
  issuer      = "https://cognito-idp.${var.region}.amazonaws.com/${var.user_pool_id}"
  with_vision = var.vision_image_uri != ""
  vision_name = "${var.name}-vision"
  api_name    = "${var.name}-api"
  table_env = {
    TABLE        = var.table_name
    MEDIA_BUCKET = var.media_bucket.id
    MODEL_BUCKET = var.models_bucket.id
  }
}

# ---------- Python API ----------
data "archive_file" "api" {
  type        = "zip"
  source_dir  = var.source_dir
  output_path = "${path.module}/api.zip"
  excludes    = ["__pycache__", "stocklane_api/__pycache__", "requirements.txt"]
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/aws/lambda/${local.api_name}"
  retention_in_days = var.log_retention_days
}

resource "aws_iam_role" "api" {
  name = "${local.api_name}-role"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole"
  }] })
}

resource "aws_iam_role_policy" "api" {
  name = "api"
  role = aws_iam_role.api.id
  policy = jsonencode({ Version = "2012-10-17", Statement = concat([
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.api.arn}:*" },
    { Effect = "Allow", Action = ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:DeleteItem", "dynamodb:BatchGetItem"], Resource = var.table_arn },
    { Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject"], Resource = ["${var.models_bucket.arn}/forecast/*"] },
    { Effect = "Allow", Action = ["kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"], Resource = var.kms_key_arn }
    ], local.with_vision ? [
    { Effect = "Allow", Action = ["lambda:InvokeFunction"], Resource = aws_lambda_function.vision[0].arn }
  ] : []) })
}

resource "aws_lambda_function" "api" {
  function_name    = local.api_name
  role             = aws_iam_role.api.arn
  runtime          = "python3.12"
  architectures    = ["arm64"]
  handler          = "stocklane_api.handler.handler"
  filename         = data.archive_file.api.output_path
  source_code_hash = data.archive_file.api.output_base64sha256
  memory_size      = 256
  timeout          = 29
  environment {
    variables = merge(local.table_env, local.with_vision ? { VISION_FUNCTION = local.vision_name } : {})
  }
  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.api.name
  }
  depends_on = [aws_iam_role_policy.api]
}

# ---------- Photo function (container image) ----------
resource "aws_cloudwatch_log_group" "vision" {
  count             = local.with_vision ? 1 : 0
  name              = "/aws/lambda/${local.vision_name}"
  retention_in_days = var.log_retention_days
}

resource "aws_iam_role" "vision" {
  count = local.with_vision ? 1 : 0
  name  = "${local.vision_name}-role"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole"
  }] })
}

resource "aws_iam_role_policy" "vision" {
  count = local.with_vision ? 1 : 0
  name  = "vision"
  role  = aws_iam_role.vision[0].id
  policy = jsonencode({ Version = "2012-10-17", Statement = concat([
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.vision[0].arn}:*" },
    { Effect = "Allow", Action = ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:BatchWriteItem"], Resource = var.table_arn },
    { Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject"], Resource = ["${var.media_bucket.arn}/images/*", "${var.models_bucket.arn}/*"] },
    { Effect = "Allow", Action = ["s3:ListBucket"], Resource = var.models_bucket.arn },
    { Effect = "Allow", Action = ["kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"], Resource = var.kms_key_arn },
    { Effect = "Allow", Action = ["textract:DetectDocumentText"], Resource = "*" }
    ], var.bedrock_invoke_arn == "" ? [] : [
    { Effect = "Allow", Action = ["bedrock:InvokeModel"], Resource = var.bedrock_invoke_arn }
  ]) })
}

resource "aws_lambda_function" "vision" {
  count         = local.with_vision ? 1 : 0
  function_name = local.vision_name
  role          = aws_iam_role.vision[0].arn
  package_type  = "Image"
  image_uri     = var.vision_image_uri
  architectures = ["x86_64"]
  memory_size   = 2048
  timeout       = 300 # scans finish in seconds; the weekly export and reindex may take minutes
  ephemeral_storage {
    size = 1024
  }
  environment {
    variables = merge(local.table_env, {
      BEDROCK_MODEL_ID    = var.bedrock_model_id
      BEDROCK_REGION      = var.bedrock_region
      BEDROCK_DAILY_LIMIT = tostring(var.bedrock_daily_limit)
      TEXTRACT_FALLBACK   = "true"
    })
  }
  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.vision[0].name
  }
  depends_on = [aws_iam_role_policy.vision]
}

# ---------- HTTP API ----------
resource "aws_apigatewayv2_api" "main" {
  name          = var.name
  protocol_type = "HTTP"
}

resource "aws_apigatewayv2_authorizer" "cognito" {
  api_id           = aws_apigatewayv2_api.main.id
  authorizer_type  = "JWT"
  name             = "cognito"
  identity_sources = ["$request.header.Authorization"]
  jwt_configuration {
    audience = [var.web_client_id]
    issuer   = local.issuer
  }
}

resource "aws_apigatewayv2_integration" "api" {
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.api.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_integration" "vision" {
  count                  = local.with_vision ? 1 : 0
  api_id                 = aws_apigatewayv2_api.main.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.vision[0].invoke_arn
  payload_format_version = "2.0"
  timeout_milliseconds   = 30000
}

resource "aws_apigatewayv2_route" "api" {
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "ANY /api/{proxy+}"
  target             = "integrations/${aws_apigatewayv2_integration.api.id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_apigatewayv2_route" "vision" {
  count              = local.with_vision ? 1 : 0
  api_id             = aws_apigatewayv2_api.main.id
  route_key          = "ANY /api/vision/{proxy+}"
  target             = "integrations/${aws_apigatewayv2_integration.vision[0].id}"
  authorization_type = "JWT"
  authorizer_id      = aws_apigatewayv2_authorizer.cognito.id
}

resource "aws_cloudwatch_log_group" "access" {
  name              = "/aws/apigateway/${var.name}"
  retention_in_days = var.log_retention_days
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.main.id
  name        = "$default"
  auto_deploy = true
  default_route_settings {
    throttling_rate_limit  = var.throttle_rate
    throttling_burst_limit = var.throttle_burst
  }
  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.access.arn
    format = jsonencode({
      time  = "$context.requestTime", method = "$context.httpMethod", path = "$context.path", status = "$context.status",
      ip    = "$context.identity.sourceIp", user = "$context.authorizer.claims.username", latency = "$context.responseLatency",
      error = "$context.authorizer.error"
    })
  }
}

resource "aws_lambda_permission" "api" {
  statement_id  = "AllowHttpApi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

resource "aws_lambda_permission" "vision" {
  count         = local.with_vision ? 1 : 0
  statement_id  = "AllowHttpApi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.vision[0].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.main.execution_arn}/*/*"
}

# ---------- Schedules (Asia/Colombo is UTC+5:30) ----------
locals {
  schedules = merge({
    forecast_export = { cron = "cron(0 20 * * ? *)", fn = aws_lambda_function.api.arn, name = aws_lambda_function.api.function_name, input = { job = "forecast-export" } }
    }, local.with_vision ? {
    photo_export = { cron = "cron(30 19 ? * SAT *)", fn = aws_lambda_function.vision[0].arn, name = aws_lambda_function.vision[0].function_name, input = { action = "export" } }
    } : {}, local.with_vision && var.warm_vision ? {
    warm = { cron = "cron(0/5 3-13 ? * MON-SAT *)", fn = aws_lambda_function.vision[0].arn, name = aws_lambda_function.vision[0].function_name, input = { action = "warm" } }
  } : {})
}

resource "aws_cloudwatch_event_rule" "this" {
  for_each            = local.schedules
  name                = "${var.name}-${replace(each.key, "_", "-")}"
  schedule_expression = each.value.cron
}

resource "aws_cloudwatch_event_target" "this" {
  for_each = local.schedules
  rule     = aws_cloudwatch_event_rule.this[each.key].name
  arn      = each.value.fn
  input    = jsonencode(each.value.input)
}

resource "aws_lambda_permission" "events" {
  for_each      = local.schedules
  statement_id  = "AllowEvents-${each.key}"
  action        = "lambda:InvokeFunction"
  function_name = each.value.name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.this[each.key].arn
}
