output "api_id" {
  value = aws_apigatewayv2_api.main.id
}

output "api_endpoint" {
  value = replace(aws_apigatewayv2_api.main.api_endpoint, "https://", "")
}

output "api_function" {
  value = aws_lambda_function.api.function_name
}

output "vision_function" {
  value = local.with_vision ? aws_lambda_function.vision[0].function_name : ""
}

output "function_names" {
  value = compact([aws_lambda_function.api.function_name, local.with_vision ? aws_lambda_function.vision[0].function_name : ""])
}
